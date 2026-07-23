import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createRoute } from "@/lib/api";
import { getToken } from "@/lib/storage";
import { buildRoutePayloadFromPlan, buildTodayRoutePlan } from "@/lib/today-route";
import type { Company, Task, UserLocationCoordinates } from "@/types/business";

// OS-level geofencing: the operating system monitors the regions in a battery-efficient
// way and wakes the app (even when fully closed) when the device enters one. On enter we
// fire a local notification reminding the user of the task waiting at that company.
// Additionally we watch a HOME region (exit → auto daily route, R15) and shopping SELLER
// regions (enter → "item available nearby" reminder, R11).

export const GEOFENCE_TASK = "arx-task-geofence";
const GEOFENCE_MAP_KEY = "arx-task-mobile.geofence-map";
const ERRAND_GEOFENCES_KEY = "arx:errand-geofences";
const AUTO_ROUTE_DATE_KEY = "arx:auto-route-date";
const AUTO_ROUTE_INPUTS_KEY = "arx:auto-route-inputs";
const GEOFENCE_RADIUS_METERS = 1000; // "1km yakınına girersem"
const SELLER_RADIUS_METERS = 1000;
const HOME_RADIUS_METERS = 150;
const HOME_REGION_ID = "home";
const SELLER_PREFIX = "seller:";
const ERRAND_PREFIX = "errand:";
const MAX_REGIONS = 20; // iOS caps simultaneous region monitoring at 20; keep Android consistent.
const MAX_ERRAND_REGIONS = 8; // Route errands share the post-company budget; cap the nearest few.

export type GeofenceReminderInput = {
  companyId: string;
  companyName: string;
  latitude: number;
  longitude: number;
  taskId: string;
  taskTitle: string;
  taskCount: number;
};

export type SellerGeofenceInput = {
  itemId: string;
  itemName: string;
  companyId: string;
  companyName: string;
  latitude: number;
  longitude: number;
};

// Errand POIs (shops found along the active route) reuse the seller-geofence shape.
export type ErrandGeofenceInput = SellerGeofenceInput;

export type SyncGeofencesInput = {
  companies: GeofenceReminderInput[];
  home?: UserLocationCoordinates | null;
  sellers?: SellerGeofenceInput[];
};

type GeofenceMapEntry =
  | { kind: "company"; companyName: string; taskTitle: string; taskId: string; taskCount: number }
  | { kind: "seller"; itemName: string; companyName: string }
  | { kind: "errand"; itemName: string; shopName: string };

// Minimal snapshot persisted during sync so the headless home-exit handler can rebuild
// today's route without the React tree (same pattern as the geofence lookup map).
type AutoRouteInputs = {
  todayKey: string;
  tasks: Array<Pick<Task, "id" | "title" | "companyId" | "dueDate" | "dueTime" | "status">>;
  companies: Array<Pick<Company, "id" | "name" | "address" | "latitude" | "longitude">>;
};

function isExpoGo() {
  return Constants.appOwnership === "expo";
}

// Lazy require so this stays Expo-Go-safe and usable from the headless background task.
function getNotificationsModule(): any {
  if (isExpoGo()) return null;
  try {
    return require("expo-notifications");
  } catch {
    return null;
  }
}

// Android needs the heads-up channel to exist before a notification can use it. The React
// tree may not be mounted when the OS wakes us headlessly, so (re)create it here too — the
// call is idempotent.
async function ensureAndroidChannel(notifications: any) {
  if (Platform.OS !== "android" || !notifications?.setNotificationChannelAsync) return;
  const importance = notifications.AndroidImportance?.MAX ?? notifications.AndroidImportance?.HIGH ?? 4;
  await notifications
    .setNotificationChannelAsync("task-reminders", {
      name: "Görev hatırlatıcıları",
      importance,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true
    })
    .catch(() => undefined);
}

async function sendLocalNotification(title: string, body: string, data: Record<string, unknown>) {
  const notifications = getNotificationsModule();
  if (!notifications?.scheduleNotificationAsync) return;
  await ensureAndroidChannel(notifications);
  await notifications.scheduleNotificationAsync({
    content: { title, body, sound: "default", data },
    // Immediate on iOS; a ~half-second date trigger on Android so it lands on the heads-up channel.
    trigger:
      Platform.OS === "android"
        ? { type: "date", date: new Date(Date.now() + 500), channelId: "task-reminders" }
        : null
  });
}

function todayKeyLocal(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// --- Background task: fires on Enter (company/seller regions) and Exit ("home"). ---
TaskManager.defineTask(GEOFENCE_TASK, async (body: any) => {
  const { data, error } = body ?? {};
  if (error || !data) return;
  const region = data.region;
  if (!region?.identifier) return;

  try {
    if (data.eventType === Location.GeofencingEventType.Exit) {
      if (region.identifier === HOME_REGION_ID) {
        await handleHomeExit();
      }
      return;
    }

    if (data.eventType !== Location.GeofencingEventType.Enter) return;
    if (region.identifier === HOME_REGION_ID) return;

    const raw = await AsyncStorage.getItem(GEOFENCE_MAP_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, GeofenceMapEntry>) : {};
    const entry = map[region.identifier];
    if (!entry) return;

    if (entry.kind === "seller") {
      await sendLocalNotification(
        "🛒 Alışveriş hatırlatması",
        `${entry.companyName} yakınında: ${entry.itemName} alınacak`,
        { url: "/shopping", geofence: true, seller: region.identifier }
      );
      return;
    }

    if (entry.kind === "errand") {
      // "Yol üzeri alışveriş fırsatı" — approaching a shop on the active route.
      await sendLocalNotification(
        "Yol üzeri alışveriş",
        `🛒 ${entry.shopName} yakında: ${entry.itemName} al`,
        { url: "/shopping", geofence: true, errand: region.identifier }
      );
      return;
    }

    const body_ =
      entry.taskCount > 1
        ? `${entry.companyName} yakınındasınız — bugün ${entry.taskCount} göreviniz var. Yapmak ister misiniz?`
        : `${entry.companyName} yakınındasınız — "${entry.taskTitle}" göreviniz vardı. Yapmak ister misiniz?`;

    await sendLocalNotification("Yakında göreviniz var", body_, {
      taskId: entry.taskId,
      companyId: region.identifier,
      url: "/today",
      geofence: true
    });
  } catch {
    // A headless task must never throw.
  }
});

// R15 — home-exit auto route. Runs headlessly at most once per day: rebuilds today's
// route plan from the inputs persisted during sync, saves it server-side with source
// "auto-home-exit" and notifies with a deep link into the route planner.
async function handleHomeExit() {
  const today = todayKeyLocal();
  const lastRun = await AsyncStorage.getItem(AUTO_ROUTE_DATE_KEY).catch(() => null);
  if (lastRun === today) return;
  await AsyncStorage.setItem(AUTO_ROUTE_DATE_KEY, today).catch(() => undefined);

  try {
    const raw = await AsyncStorage.getItem(AUTO_ROUTE_INPUTS_KEY);
    const inputs = raw ? (JSON.parse(raw) as AutoRouteInputs) : null;
    const todayTasks = (inputs?.tasks ?? []).filter((task) => task.dueDate === today && task.status !== "done");
    if (!inputs || todayTasks.length === 0) {
      await sendLocalNotification("Günaydın!", "Bugün planlı göreviniz yok.", { url: "/today" });
      return;
    }

    let origin: UserLocationCoordinates | null = null;
    try {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      origin = { latitude: current.coords.latitude, longitude: current.coords.longitude };
    } catch {
      const lastKnown = await Location.getLastKnownPositionAsync().catch(() => null);
      if (lastKnown?.coords) {
        origin = { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
      }
    }

    const plan = buildTodayRoutePlan(
      todayTasks as unknown as Task[],
      inputs.companies as unknown as Company[],
      origin
    );

    if (!plan.stops.length) {
      await sendLocalNotification("Günaydın!", "Bugün planlı göreviniz yok.", { url: "/today" });
      return;
    }

    const token = await getToken().catch(() => null);
    if (token) {
      const payload = buildRoutePayloadFromPlan(plan, origin, today, "auto-home-exit");
      await createRoute(token, { ...payload, status: "planned" }).catch(() => undefined);
    }

    await sendLocalNotification(
      "Günaydın! Bugünkü rotanız hazır",
      `Bugünkü rotanız hazır — ${plan.stops.length} durak`,
      { url: "/route-planner", autoRoute: true }
    );
  } catch {
    await sendLocalNotification("Günaydın!", "Bugün planlı göreviniz yok.", { url: "/today" }).catch(() => undefined);
  }
}

// Requests foreground THEN background ("Allow all the time") location permission. Background
// is a separate OS prompt and is required for geofencing to run while the app is closed.
export async function requestGeofencePermissions(): Promise<{ foreground: boolean; background: boolean }> {
  if (isExpoGo()) return { foreground: false, background: false };
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted") return { foreground: false, background: false };
    const bg = await Location.requestBackgroundPermissionsAsync();
    return { foreground: true, background: bg.status === "granted" };
  } catch {
    return { foreground: false, background: false };
  }
}

// Persists the minimal inputs the headless home-exit handler needs to rebuild today's route.
export async function persistAutoRouteInputs(tasks: Task[], companies: Company[]) {
  try {
    const todayKey = todayKeyLocal();
    const inputs: AutoRouteInputs = {
      todayKey,
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        companyId: task.companyId,
        dueDate: task.dueDate,
        dueTime: task.dueTime,
        status: task.status
      })),
      companies: companies.map((company) => ({
        id: company.id,
        name: company.name,
        address: company.address,
        latitude: company.latitude,
        longitude: company.longitude
      }))
    };
    await AsyncStorage.setItem(AUTO_ROUTE_INPUTS_KEY, JSON.stringify(inputs));
  } catch {
    // Best-effort.
  }
}

function hasCoords(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
}

// Persists the active route's errand POIs so they survive across geofence re-syncs (data
// refreshes) until the route ends. Passing an empty list clears them. syncGeofences reads
// this back on every rebuild and folds the shops into the region set.
export async function persistErrandGeofences(errands: ErrandGeofenceInput[]) {
  try {
    if (!errands.length) {
      await AsyncStorage.removeItem(ERRAND_GEOFENCES_KEY);
      return;
    }
    await AsyncStorage.setItem(ERRAND_GEOFENCES_KEY, JSON.stringify(errands.slice(0, MAX_ERRAND_REGIONS)));
  } catch {
    // Best-effort.
  }
}

async function loadErrandGeofences(): Promise<ErrandGeofenceInput[]> {
  try {
    const raw = await AsyncStorage.getItem(ERRAND_GEOFENCES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ErrandGeofenceInput[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Rebuilds the full geofence set (home + today's task companies + route errands + shopping
// sellers) within the 20-region OS budget. Priority: home → company reminders → route errands
// → sellers (errands + sellers share the remaining slots). Persists a lookup map the headless
// task reads to compose the notifications.
export async function syncGeofences(input: SyncGeofencesInput) {
  if (isExpoGo()) return;
  try {
    const { companies: reminders, home = null, sellers = [] } = input;

    const byCompany = new Map<string, GeofenceReminderInput>();
    for (const reminder of reminders) {
      if (!hasCoords(reminder.latitude, reminder.longitude)) continue;
      if (!byCompany.has(reminder.companyId)) byCompany.set(reminder.companyId, reminder);
    }

    type RegionSpec = {
      identifier: string;
      latitude: number;
      longitude: number;
      radius: number;
      notifyOnEnter: boolean;
      notifyOnExit: boolean;
    };
    const regions: RegionSpec[] = [];
    const map: Record<string, GeofenceMapEntry> = {};

    // 1. Home region — exit only (auto daily route).
    if (home && hasCoords(home.latitude, home.longitude)) {
      regions.push({
        identifier: HOME_REGION_ID,
        latitude: home.latitude,
        longitude: home.longitude,
        radius: HOME_RADIUS_METERS,
        notifyOnEnter: false,
        notifyOnExit: true
      });
    }

    // 2. Today's task companies.
    for (const reminder of byCompany.values()) {
      if (regions.length >= MAX_REGIONS) break;
      regions.push({
        identifier: reminder.companyId,
        latitude: reminder.latitude,
        longitude: reminder.longitude,
        radius: GEOFENCE_RADIUS_METERS,
        notifyOnEnter: true,
        notifyOnExit: false
      });
      map[reminder.companyId] = {
        kind: "company",
        companyName: reminder.companyName,
        taskTitle: reminder.taskTitle,
        taskId: reminder.taskId,
        taskCount: reminder.taskCount
      };
    }

    // 3. Route errands (shops along the active route) — share the post-company budget with
    // sellers. They're already nearest-to-route first and capped, and take precedence over
    // generic sellers because they only exist while a route is running.
    const errands = (await loadErrandGeofences()).slice(0, MAX_ERRAND_REGIONS);
    for (const errand of errands) {
      if (regions.length >= MAX_REGIONS) break;
      if (!hasCoords(errand.latitude, errand.longitude)) continue;
      // companyId is already a synthetic `errand:${itemId}:${lat},${lng}` id.
      const identifier = errand.companyId.startsWith(ERRAND_PREFIX)
        ? errand.companyId
        : `${ERRAND_PREFIX}${errand.itemId}:${errand.companyId}`;
      if (map[identifier]) continue;
      regions.push({
        identifier,
        latitude: errand.latitude,
        longitude: errand.longitude,
        radius: SELLER_RADIUS_METERS,
        notifyOnEnter: true,
        notifyOnExit: false
      });
      map[identifier] = { kind: "errand", itemName: errand.itemName, shopName: errand.companyName };
    }

    // 4. Shopping sellers — lowest priority, fill the remaining budget.
    for (const seller of sellers) {
      if (regions.length >= MAX_REGIONS) break;
      if (!hasCoords(seller.latitude, seller.longitude)) continue;
      const identifier = `${SELLER_PREFIX}${seller.itemId}:${seller.companyId}`;
      if (map[identifier]) continue;
      regions.push({
        identifier,
        latitude: seller.latitude,
        longitude: seller.longitude,
        radius: SELLER_RADIUS_METERS,
        notifyOnEnter: true,
        notifyOnExit: false
      });
      map[identifier] = { kind: "seller", itemName: seller.itemName, companyName: seller.companyName };
    }

    await AsyncStorage.setItem(GEOFENCE_MAP_KEY, JSON.stringify(map));

    const isRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK).catch(() => false);
    const fg = await Location.getForegroundPermissionsAsync();
    const bg = await Location.getBackgroundPermissionsAsync();
    const canMonitor = fg.status === "granted" && bg.status === "granted";

    if (regions.length === 0 || !canMonitor) {
      if (isRegistered) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => undefined);
      return;
    }

    // startGeofencingAsync replaces the previously monitored regions for this task.
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
  } catch {
    // Best-effort — never crash the app over geofencing.
  }
}
