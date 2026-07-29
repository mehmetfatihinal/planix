import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createRoute, routeErrandStops } from "@/lib/api";
import { getToken } from "@/lib/storage";
import { buildRoutePayloadFromPlan, buildTodayRoutePlan } from "@/lib/today-route";
import { markNotified, shouldNotify } from "@/lib/geofence-throttle";
import {
  buildDepartureSummary,
  findTaskOpportunities,
  MAX_OPEN_TASK_SNAPSHOT,
  MAX_TASK_OPPORTUNITY_REGIONS,
  ON_THE_WAY_BUFFER_METERS,
  taskSortKey,
  type Corridor,
  type TaskOpportunity
} from "@/lib/route-opportunities";
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
const TASK_OPPORTUNITIES_KEY = "arx:task-opportunities";
const SYNC_INPUT_KEY = "arx:geofence-sync-input";
const TASK_OPPORTUNITY_PREFIX = "opp:";
// GPS jitter guard for the two-phase home-exit lock: a run that hasn't marked itself
// completed within this window is assumed abandoned (headless process killed) and a later
// exit the same day may retry it.
const AUTO_ROUTE_RETRY_WINDOW_MS = 5 * 60 * 1000;

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
  | { kind: "task-opportunity"; companyName: string; taskTitle: string; taskId: string; taskCount: number }
  | { kind: "seller"; itemName: string; companyName: string }
  | { kind: "errand"; itemName: string; shopName: string };

// Minimal snapshot persisted during sync so the headless home-exit handler can rebuild
// today's route without the React tree (same pattern as the geofence lookup map). The
// `tasks` field now holds ALL open tasks with a companyId (see persistAutoRouteInputs
// below), not just today's — on-the-way opportunities are evaluated regardless of date.
type AutoRouteInputs = {
  todayKey: string;
  tasks: Array<Pick<Task, "id" | "title" | "companyId" | "dueDate" | "dueTime" | "status">>;
  companies: Array<Pick<Company, "id" | "name" | "address" | "latitude" | "longitude">>;
};

// Two-phase lock for the once-a-day home-exit run, stored at AUTO_ROUTE_DATE_KEY. A record
// with `completed: false` means a run for `day` started at `startedAt` but hasn't finished —
// either it's still in flight (GPS acquisition, the errand fetch) or the headless process was
// killed before reaching the summary notification. `AUTO_ROUTE_RETRY_WINDOW_MS` after
// `startedAt`, an incomplete run is treated as abandoned and may be retried the same day.
type AutoRouteLockRecord = {
  day: string;
  startedAt: number;
  completed: boolean;
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
  // "geofence-reminder" only has a "Bugün sorma" action, and that action's handler is a
  // no-op unless `data.regionId` is present (see notifications.ts). Attaching the category
  // to a notification without a regionId (e.g. the home-exit summary) would show a button
  // that does nothing when tapped, so the key is included only when it will actually work —
  // built via spread so it is entirely absent otherwise, not present-but-undefined.
  const hasRegionId = typeof data.regionId === "string" && data.regionId.length > 0;
  await notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: "default",
      data,
      ...(hasRegionId ? { categoryIdentifier: "geofence-reminder" } : {})
    },
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

    // Tekrar kontrolü: aynı yer için tür başına bekleme süresi dolmadan
    // veya "Bugün sorma" denmişken bildirim çıkmaz.
    if (!(await shouldNotify(region.identifier, entry.kind))) return;

    if (entry.kind === "seller") {
      await sendLocalNotification(
        "🛒 Alışveriş hatırlatması",
        `${entry.companyName} yakınında: ${entry.itemName} alınacak`,
        { url: "/shopping", geofence: true, seller: region.identifier, regionId: region.identifier }
      );
      await markNotified(region.identifier);
      return;
    }

    if (entry.kind === "errand") {
      // "Yol üzeri alışveriş fırsatı" — approaching a shop on the active route.
      await sendLocalNotification(
        "Yol üzeri alışveriş",
        `🛒 ${entry.shopName} yakında: ${entry.itemName} al`,
        { url: "/shopping", geofence: true, errand: region.identifier, regionId: region.identifier }
      );
      await markNotified(region.identifier);
      return;
    }

    if (entry.kind === "task-opportunity") {
      // Bugüne tarihli olmayan ama güzergâhın üzerinde kalan açık iş.
      const body =
        entry.taskCount > 1
          ? `${entry.companyName} yakınında — ${entry.taskCount} açık işin var`
          : `${entry.companyName} yakınında — "${entry.taskTitle}"`;
      await sendLocalNotification("Yol üzerinde işin var", body, {
        taskId: entry.taskId,
        companyId: region.identifier.slice(TASK_OPPORTUNITY_PREFIX.length),
        url: "/today",
        geofence: true,
        regionId: region.identifier
      });
      await markNotified(region.identifier);
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
      geofence: true,
      regionId: region.identifier
    });
    await markNotified(region.identifier);
  } catch {
    // A headless task must never throw.
  }
});

// Never throws: an unreadable value, or a legacy bare-date-string value written by a
// previous build (pre-two-phase lock), is treated as "no record for today" so the handler
// can never be permanently wedged by a malformed or outdated stored value.
async function readAutoRouteLock(): Promise<AutoRouteLockRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTO_ROUTE_DATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.day === "string" &&
      typeof parsed.startedAt === "number" &&
      typeof parsed.completed === "boolean"
    ) {
      return parsed as AutoRouteLockRecord;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeAutoRouteLock(record: AutoRouteLockRecord) {
  await AsyncStorage.setItem(AUTO_ROUTE_DATE_KEY, JSON.stringify(record)).catch(() => undefined);
}

// R15 — home-exit auto route. Runs headlessly at most once per day: rebuilds today's
// route plan from the inputs persisted during sync, saves it server-side with source
// "auto-home-exit", hesaplar yol üzeri fırsatları (görevler yerel, alışveriş sunucudan)
// ve tek bir özet bildirimle haber verir.
//
// Two-phase lock: a bare "started" record is written before any work so a same-day re-entry
// while a run is in flight is a no-op, but if the headless process is killed before the run
// finishes (GPS acquisition + up to an 8s errand timeout is a real risk), the record is only
// "completed" once a notification has actually gone out — an exit more than
// AUTO_ROUTE_RETRY_WINDOW_MS later the same day is allowed to retry instead of losing the
// whole day.
async function handleHomeExit() {
  const today = todayKeyLocal();
  const lock = await readAutoRouteLock();
  if (lock && lock.day === today) {
    if (lock.completed) return;
    if (Date.now() - lock.startedAt < AUTO_ROUTE_RETRY_WINDOW_MS) return;
  }
  const startedAt = Date.now();
  await writeAutoRouteLock({ day: today, startedAt, completed: false });

  try {
    const raw = await AsyncStorage.getItem(AUTO_ROUTE_INPUTS_KEY);
    const inputs = raw ? (JSON.parse(raw) as AutoRouteInputs) : null;
    const openTasks = inputs?.tasks ?? [];
    const companies = inputs?.companies ?? [];

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

    const todayTasks = openTasks.filter((task) => task.dueDate === today && task.status !== "done");
    const plan = buildTodayRoutePlan(
      todayTasks as unknown as Task[],
      companies as unknown as Company[],
      origin
    );

    const token = await getToken().catch(() => null);
    if (plan.stops.length && token) {
      const payload = buildRoutePayloadFromPlan(plan, origin, today, "auto-home-exit");
      // Errand fetch aşağıda 8sn ile sınırlı — aynı nedenle burada da sınırsız ağ
      // beklemesi headless görevi asıp fırsat hesabına, bölge yeniden kurulumuna ve
      // özet bildirimine hiç ulaşmadan öldürülmesine yol açabilir.
      await withTimeout(createRoute(token, { ...payload, status: "planned" }), 8000).catch(() => undefined);
    }

    // Koridor: rota varsa [konum, ...duraklar], yoksa [konum].
    const corridor: Corridor = [];
    if (origin) corridor.push(origin);
    for (const stop of plan.stops) {
      if (hasCoords(stop.company.latitude, stop.company.longitude)) {
        corridor.push({ latitude: stop.company.latitude, longitude: stop.company.longitude });
      }
    }

    // Bugünün görev firmaları ve rota durakları hariç: onların kendi bildirimi var.
    const excludeCompanyIds = [
      ...plan.stops.map((stop) => stop.company.id),
      ...todayTasks.map((task) => task.companyId).filter((id): id is string => Boolean(id))
    ];

    const opportunities: TaskOpportunity[] = corridor.length
      ? findTaskOpportunities({
          tasks: openTasks,
          companies,
          corridor,
          bufferMeters: corridor.length > 1 ? ON_THE_WAY_BUFFER_METERS : null,
          excludeCompanyIds,
          limit: MAX_TASK_OPPORTUNITY_REGIONS
        })
      : [];

    // Koridor boşsa (GPS başarısız + kullanılabilir koordinatlı durak yok) hiçbir şey
    // değerlendirilmedi demektir — bu, "değerlendirildi, bulunamadı" anlamına gelen boş
    // bir kayıtla karıştırılmamalı; aksi hâlde gün boyu yakın-N fallback'i haksız yere
    // bastırılır. Yalnızca gerçekten bir değerlendirme yapıldıysa yaz.
    if (corridor.length) {
      await persistTaskOpportunities({ date: today, source: "route", items: opportunities });
    }

    // Alışveriş fırsatları — best-effort, ağ yoksa özet yalnızca görev kısmıyla gider.
    let errandCount = 0;
    if (token && corridor.length) {
      try {
        const response = await withTimeout(
          routeErrandStops(token, { coords: corridor.map((point) => [point.latitude, point.longitude]) }),
          8000
        );
        const matches = response?.matches ?? [];
        errandCount = matches.length;
        await persistErrandGeofences(
          matches.map((match) => ({
            itemId: match.itemId,
            itemName: match.itemName,
            companyId: `${ERRAND_PREFIX}${match.itemId}:${match.latitude},${match.longitude}`,
            companyName: match.shopName,
            latitude: match.latitude,
            longitude: match.longitude
          }))
        );
      } catch {
        // Ağ/zaman aşımı — alışveriş kısmı atlanır.
      }
    }

    await resyncGeofences();

    const summary = buildDepartureSummary({
      stopCount: plan.stops.length,
      taskOpportunityCount: opportunities.length,
      errandCount
    });
    await sendLocalNotification(summary.title, summary.body, {
      url: plan.stops.length ? "/route-planner" : "/today",
      autoRoute: true
    });
    await writeAutoRouteLock({ day: today, startedAt, completed: true });
  } catch {
    await sendLocalNotification("Günaydın!", "Bugün planlı göreviniz yok.", { url: "/today" }).catch(
      () => undefined
    );
    // Mark completed even on the fallback path so a persistently-failing day isn't retried
    // in a loop every time the user steps in and out of the home region.
    await writeAutoRouteLock({ day: today, startedAt, completed: true });
  }
}

// Headless görevin OS tarafından öldürülmemesi için ağ çağrılarına üst sınır.
function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

// Headless çıkış işleyicisinin ihtiyaç duyduğu asgari girdiyi saklar.
// Bugünün görevleri değil, companyId taşıyan TÜM açık görevler saklanır —
// yol üzeri fırsatlar tarih bağımsız değerlendirilir.
export async function persistAutoRouteInputs(tasks: Task[], companies: Company[]) {
  try {
    const openTasks = tasks
      .filter((task) => task.status !== "done" && Boolean(task.companyId))
      .sort((left, right) => taskSortKey(left).localeCompare(taskSortKey(right)))
      .slice(0, MAX_OPEN_TASK_SNAPSHOT);

    const inputs: AutoRouteInputs = {
      todayKey: todayKeyLocal(),
      tasks: openTasks.map((task) => ({
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

// Yol üzeri görev fırsatları. `source: "route"` evden çıkış / manuel rota
// başlatmadan gelir ve gün içinde veri senkronuyla ezilmez; `source: "nearby"`
// rota yokken konuma en yakın firmalardan üretilir.
export type StoredTaskOpportunities = {
  date: string;
  source: "route" | "nearby";
  items: TaskOpportunity[];
};

// Always persists the record, even when `items` is empty — an empty array means "evaluated
// today, found nothing", which is a meaningful fact distinct from "nothing persisted today".
// Callers (e.g. the nearby fallback) rely on this to tell apart an already-run route
// evaluation from a day with no record at all, so a route-sourced record isn't overwritten
// by a nearby-sourced one later the same day.
export async function persistTaskOpportunities(payload: StoredTaskOpportunities) {
  try {
    await AsyncStorage.setItem(
      TASK_OPPORTUNITIES_KEY,
      JSON.stringify({ ...payload, items: payload.items.slice(0, MAX_TASK_OPPORTUNITY_REGIONS) })
    );
  } catch {
    // Best-effort.
  }
}

export async function loadStoredTaskOpportunities(): Promise<StoredTaskOpportunities | null> {
  try {
    const raw = await AsyncStorage.getItem(TASK_OPPORTUNITIES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTaskOpportunities;
    return Array.isArray(parsed?.items) ? parsed : null;
  } catch {
    return null;
  }
}

// Yalnızca bugüne ait kaydı döner; tarih değişmişse kayıt geçersizdir.
export async function loadTaskOpportunities(todayKey: string): Promise<TaskOpportunity[]> {
  const stored = await loadStoredTaskOpportunities();
  if (!stored || stored.date !== todayKey) return [];
  return stored.items.slice(0, MAX_TASK_OPPORTUNITY_REGIONS);
}

// Rebuilds the full geofence set (home + today's task companies + on-the-way task
// opportunities + route errands + shopping sellers) within the 20-region OS budget.
// Priority: home → company reminders → task opportunities → route errands → sellers.
// Persists a lookup map the headless task reads to compose the notifications.
export async function syncGeofences(input: SyncGeofencesInput) {
  if (isExpoGo()) return;
  try {
    await AsyncStorage.setItem(SYNC_INPUT_KEY, JSON.stringify(input)).catch(() => undefined);

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

    // 2.5 Yol üzeri görev fırsatları — bugünün görev firmalarından sonra, alışverişten
    // önce. Kullanıcının çerçevesi "o iş için bir daha dışarı çıkmayayım"; alışveriş ikincil.
    const opportunities = await loadTaskOpportunities(todayKeyLocal());
    for (const opportunity of opportunities) {
      if (regions.length >= MAX_REGIONS) break;
      if (!hasCoords(opportunity.latitude, opportunity.longitude)) continue;
      const identifier = `${TASK_OPPORTUNITY_PREFIX}${opportunity.companyId}`;
      if (map[identifier]) continue;
      regions.push({
        identifier,
        latitude: opportunity.latitude,
        longitude: opportunity.longitude,
        radius: GEOFENCE_RADIUS_METERS,
        notifyOnEnter: true,
        notifyOnExit: false
      });
      map[identifier] = {
        kind: "task-opportunity",
        companyName: opportunity.companyName,
        taskTitle: opportunity.taskTitle,
        taskId: opportunity.taskId,
        taskCount: opportunity.taskCount
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

// Headless uyanmada React ağacı yok; son sync girdisini diskten okuyup bölgeleri
// yeniden kurar. Fırsat ve errand listeleri kendi depolarından okunduğu için
// bu çağrı onların en güncel hâlini kullanır.
export async function resyncGeofences() {
  try {
    const raw = await AsyncStorage.getItem(SYNC_INPUT_KEY);
    if (!raw) return;
    const input = JSON.parse(raw) as SyncGeofencesInput;
    if (!input || !Array.isArray(input.companies)) return;
    await syncGeofences(input);
  } catch {
    // Best-effort.
  }
}
