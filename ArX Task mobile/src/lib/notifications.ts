import { Platform } from "react-native";
import * as Device from "expo-device";
import Constants from "expo-constants";
import {
  applyNotificationAction,
  approveTaskRequest,
  mobileNotificationStatus,
  registerMobileDevice,
  rejectTaskRequest,
  removeMobileDevice
} from "@/lib/api";

type NotificationsModuleLike = {
  IosAuthorizationStatus?: { PROVISIONAL?: number };
  DEFAULT_ACTION_IDENTIFIER?: string;
  AndroidImportance?: { MAX?: number; HIGH?: number; DEFAULT?: number };
  AndroidNotificationVisibility?: { PUBLIC?: number; PRIVATE?: number };
  setNotificationHandler?: (handler: {
    handleNotification: () => Promise<{
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
      shouldShowBanner: boolean;
      shouldShowList: boolean;
    }>;
  }) => void;
  setNotificationCategoryAsync?: (identifier: string, actions: Array<{ identifier: string; buttonTitle: string }>) => Promise<unknown>;
  setNotificationChannelAsync?: (
    channelId: string,
    channel: {
      name: string;
      importance: number;
      sound?: string | null;
      vibrationPattern?: number[];
      lockscreenVisibility?: number;
      enableVibrate?: boolean;
    }
  ) => Promise<unknown>;
  getPermissionsAsync?: () => Promise<{ granted?: boolean; canAskAgain?: boolean; status?: string; ios?: { status?: number } }>;
  requestPermissionsAsync?: () => Promise<{ granted?: boolean; canAskAgain?: boolean; status?: string; ios?: { status?: number } }>;
  getExpoPushTokenAsync?: (options?: { projectId?: string }) => Promise<{ data: string }>;
  addNotificationResponseReceivedListener?: (listener: (response: any) => void) => { remove: () => void };
  scheduleNotificationAsync?: (request: {
    identifier?: string;
    content: {
      title?: string;
      body?: string;
      sound?: string | null;
      data?: Record<string, unknown>;
      categoryIdentifier?: string;
    };
    trigger:
      | { type: "date"; date: Date; channelId?: string }
      | { type: "timeInterval"; seconds: number; repeats?: boolean; channelId?: string }
      | { type: "daily"; hour: number; minute: number; channelId?: string }
      | null;
  }) => Promise<string>;
  cancelAllScheduledNotificationsAsync?: () => Promise<void>;
  getAllScheduledNotificationsAsync?: () => Promise<Array<{ identifier?: string }>>;
  cancelScheduledNotificationAsync?: (identifier: string) => Promise<void>;
};

// A minimal, decoupled shape so this module never imports the business types.
export type LocalReminderInput = {
  id: string;
  title: string;
  dueAt: Date | null;
  companyName?: string | null;
};

// Alışkanlık (habit) yerel bildirimi girdisi — iş tiplerinden bağımsız minimal şekil.
export type HabitReminderInput = {
  id: string;
  title: string;
  stage: "planning" | "active";
  reminderTime?: string | null; // HH:mm
  nudgeIntervalDays?: number;
};

function isExpoGo() {
  return Constants.appOwnership === "expo";
}

function getNotificationsModule(): NotificationsModuleLike | null {
  if (isExpoGo()) {
    return null;
  }

  try {
    return require("expo-notifications") as NotificationsModuleLike;
  } catch {
    return null;
  }
}

function isGranted(settings: { granted?: boolean; ios?: { status?: number } } | null | undefined, module: NotificationsModuleLike | null) {
  const provisional = module?.IosAuthorizationStatus?.PROVISIONAL;
  return Boolean(settings?.granted || (provisional !== undefined && settings?.ios?.status === provisional));
}

export function initializeNotifications() {
  const notifications = getNotificationsModule();
  notifications?.setNotificationHandler?.({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true
    })
  });

  // Android requires an explicit notification channel with MAX importance
  // for foreground / heads-up banners to actually show. Without this every
  // notification falls through the default low-importance channel and the
  // banner is invisible while the app is in the foreground.
  if (Platform.OS === "android" && notifications?.setNotificationChannelAsync) {
    const importance =
      notifications.AndroidImportance?.MAX ??
      notifications.AndroidImportance?.HIGH ??
      4; // numeric fallback if constants are missing
    const visibility = notifications.AndroidNotificationVisibility?.PUBLIC ?? 1;
    notifications
      .setNotificationChannelAsync("task-reminders", {
        name: "Görev hatırlatıcıları",
        importance,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: visibility,
        enableVibrate: true
      })
      .catch(() => undefined);
    notifications
      .setNotificationChannelAsync("habit-reminders", {
        name: "Alışkanlık hatırlatıcıları",
        importance,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: visibility,
        enableVibrate: true
      })
      .catch(() => undefined);
  }
}

export async function configureNotificationCategories() {
  const notifications = getNotificationsModule();
  if (!notifications?.setNotificationCategoryAsync) {
    return;
  }

  await notifications.setNotificationCategoryAsync("task-reminder", [
    { identifier: "complete", buttonTitle: "Tamamlandı" },
    { identifier: "snooze-1h", buttonTitle: "1 Saat Ertele" }
  ]);

  // Admin sees this on approval-request push; lets them act without opening the app.
  await notifications.setNotificationCategoryAsync("approval-request", [
    { identifier: "approve", buttonTitle: "Onayla" },
    { identifier: "reject", buttonTitle: "Reddet" }
  ]);
}

export async function getNotificationPermission() {
  const notifications = getNotificationsModule();
  if (!notifications?.getPermissionsAsync) {
    return {
      granted: false,
      canAskAgain: false,
      status: isExpoGo() ? "expo-go-unsupported" : "unavailable"
    };
  }

  const settings = await notifications.getPermissionsAsync();
  return {
    granted: isGranted(settings, notifications),
    canAskAgain: settings.canAskAgain ?? false,
    status: settings.status ?? "unknown"
  };
}

export async function requestNotificationPermission() {
  const notifications = getNotificationsModule();
  if (!notifications?.requestPermissionsAsync) {
    return {
      granted: false,
      canAskAgain: false,
      status: isExpoGo() ? "expo-go-unsupported" : "unavailable"
    };
  }

  const settings = await notifications.requestPermissionsAsync();
  return {
    granted: isGranted(settings, notifications),
    canAskAgain: settings.canAskAgain ?? false,
    status: settings.status ?? "unknown"
  };
}

export async function ensureMobilePushRegistration(token: string) {
  const notifications = getNotificationsModule();
  if (!notifications?.requestPermissionsAsync || !notifications?.getExpoPushTokenAsync) {
    return { subscribed: false, reason: "expo-go-unsupported" as const };
  }

  if (!Device.isDevice) {
    return { subscribed: false, reason: "not-supported" as const };
  }

  // Request permission on ALL platforms first — it is required for BOTH remote push and the
  // on-device local reminder fallback. Previously iOS returned here before ever asking, so
  // iOS devices got no reminders at all.
  const permission = await notifications.requestPermissionsAsync();
  if (!isGranted(permission, notifications)) {
    return { subscribed: false, reason: "permission-denied" as const };
  }

  // Remote Expo push-token registration is currently wired for Android only; on other
  // platforms permission is still granted above so local scheduled reminders work.
  if (Platform.OS !== "android") {
    return { subscribed: false, reason: "local-only" as const };
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const pushToken = (await notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await registerMobileDevice(token, {
    expoPushToken: pushToken,
    platform: Platform.OS,
    deviceName: Device.deviceName ?? "",
    deviceModel: Device.modelName ?? "",
    appVersion: Constants.expoConfig?.version ?? "1.0.0"
  });

  return { subscribed: true as const, token: pushToken };
}

export async function disconnectMobilePush(token: string, expoPushToken: string) {
  await removeMobileDevice(token, expoPushToken);
}

export async function loadMobileNotificationStatus(token: string) {
  return mobileNotificationStatus(token);
}

// On-device fallback for task reminders. Server push (Expo → FCM) can silently fail
// — missing FCM creds, expired token, offline device, timezone drift — leaving the user
// with NO reminder at all. Scheduling an OS-level local notification at each task's due
// time guarantees the reminder fires on the device regardless of the server chain. The
// whole local schedule is rebuilt on every call so it always mirrors the latest task state.
export async function syncLocalTaskReminders(reminders: LocalReminderInput[]) {
  const notifications = getNotificationsModule();
  if (!notifications?.scheduleNotificationAsync || !notifications?.cancelAllScheduledNotificationsAsync) {
    return; // Expo Go / unsupported — nothing to schedule.
  }

  try {
    if (notifications.getPermissionsAsync) {
      const permission = await notifications.getPermissionsAsync();
      if (!isGranted(permission, notifications)) {
        return; // no permission → don't attempt (and don't wipe an empty schedule pointlessly)
      }
    }

    // Rebuild from scratch so cancelled / rescheduled / completed tasks don't leave stale alerts.
    // Only clear the task-reminder schedule — habit (habit-*) notifications are managed
    // separately by syncHabitReminders and must survive this rebuild.
    if (notifications.getAllScheduledNotificationsAsync && notifications.cancelScheduledNotificationAsync) {
      const scheduled = await notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        scheduled
          .filter((item) => !String(item.identifier ?? "").startsWith("habit-"))
          .map((item) => notifications.cancelScheduledNotificationAsync!(String(item.identifier ?? "")))
      );
    } else {
      await notifications.cancelAllScheduledNotificationsAsync();
    }

    const now = Date.now();
    for (const reminder of reminders) {
      if (!reminder.dueAt) continue;
      const when = reminder.dueAt.getTime();
      if (Number.isNaN(when) || when <= now + 5_000) continue; // skip past / near-immediate

      const title = reminder.companyName ? `${reminder.companyName} · ${reminder.title}` : reminder.title;
      await notifications.scheduleNotificationAsync({
        content: {
          // No categoryIdentifier: the per-alert action token that the Complete / Snooze
          // buttons need is server-issued and absent on local notifications, so we skip the
          // buttons (tapping opens /today where the task can be actioned).
          title,
          body: "Görev hatırlatması",
          sound: "default",
          data: { taskId: reminder.id, url: "/today", local: true }
        },
        trigger: { type: "date", date: reminder.dueAt, channelId: "task-reminders" }
      });
    }
  } catch {
    // Best-effort: a local-reminder failure must never crash the app.
  }
}

function parseHabitTime(value?: string | null): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!match) return { hour: 20, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return { hour, minute };
}

// On-device habit engine (remote push/FCM is not wired for this, so local notifications
// make it work). PLANNING habits get a repeating nudge every N days ("ne zaman başlamak
// istiyorsun?"); ACTIVE habits get a daily reminder at their chosen time. Uses stable
// per-habit identifiers (habit-nudge-<id> / habit-daily-<id>) so re-syncing never
// duplicates, and cancels notifications of habits that were stopped / completed / switched
// stage. Task-reminder notifications (non habit-*) are left untouched. Scheduled local
// notifications persist at the OS level across app restarts, so the nudge is only scheduled
// when absent — its N-day countdown is preserved and never reset on app open.
export async function syncHabitReminders(habits: HabitReminderInput[]) {
  const notifications = getNotificationsModule();
  if (!notifications?.scheduleNotificationAsync) {
    return; // Expo Go / unsupported — nothing to schedule.
  }

  try {
    if (notifications.getPermissionsAsync) {
      const permission = await notifications.getPermissionsAsync();
      if (!isGranted(permission, notifications)) {
        return; // no permission → don't attempt.
      }
    }

    const wanted = new Map<string, HabitReminderInput>();
    for (const habit of habits) {
      const identifier = habit.stage === "active" ? `habit-daily-${habit.id}` : `habit-nudge-${habit.id}`;
      wanted.set(identifier, habit);
    }

    // Existing habit-* schedule (survives app restarts). Cancel the ones no longer wanted.
    const existing = new Set<string>();
    if (notifications.getAllScheduledNotificationsAsync && notifications.cancelScheduledNotificationAsync) {
      const scheduled = await notifications.getAllScheduledNotificationsAsync();
      for (const item of scheduled) {
        const id = String(item.identifier ?? "");
        if (id.startsWith("habit-")) existing.add(id);
      }
      await Promise.all(
        [...existing]
          .filter((id) => !wanted.has(id))
          .map((id) => notifications.cancelScheduledNotificationAsync!(id))
      );
    }

    const channelId = "habit-reminders";
    for (const [identifier, habit] of wanted) {
      if (habit.stage === "active") {
        // Daily reminder is time-anchored — (re)schedule so a changed time is honored.
        const { hour, minute } = parseHabitTime(habit.reminderTime);
        await notifications.cancelScheduledNotificationAsync?.(identifier);
        await notifications.scheduleNotificationAsync({
          identifier,
          content: {
            title: `Alışkanlık: ${habit.title}`,
            body: "Bugünkü adımını atmayı unutma.",
            sound: "default",
            data: { url: "/habits", habit: habit.id, local: true }
          },
          trigger: { type: "daily", hour, minute, channelId }
        });
      } else if (!existing.has(identifier)) {
        // Repeating nudge — only schedule when absent so the N-day countdown is preserved
        // across syncs and app restarts (idempotent by stable identifier).
        const days = Math.max(1, Math.round(habit.nudgeIntervalDays ?? 2));
        await notifications.scheduleNotificationAsync({
          identifier,
          content: {
            title: `«${habit.title}» — ne zaman başlamak istiyorsun?`,
            body: "Bir başlangıç tarihi seç ya da sonra hatırlatalım.",
            sound: "default",
            data: { url: "/habits", habit: habit.id, local: true }
          },
          trigger: { type: "timeInterval", seconds: days * 24 * 60 * 60, repeats: true, channelId }
        });
      }
    }
  } catch {
    // Best-effort: a habit-reminder failure must never crash the app.
  }
}

export function addNotificationResponseReceivedListener(listener: (response: any) => void) {
  const notifications = getNotificationsModule();
  if (!notifications?.addNotificationResponseReceivedListener) {
    return { remove: () => undefined };
  }

  return notifications.addNotificationResponseReceivedListener(listener);
}

export function getDefaultNotificationActionIdentifier() {
  return getNotificationsModule()?.DEFAULT_ACTION_IDENTIFIER ?? "expo.default";
}

type NotificationPayload = {
  token?: string;
  url?: string;
  taskId?: string;
  requesterId?: string;
};

export async function handleNotificationActionResponse(response: any, authToken?: string | null) {
  const payload = response?.notification?.request?.content?.data as NotificationPayload | undefined;
  const actionIdentifier = response?.actionIdentifier;
  if (!payload || actionIdentifier === getDefaultNotificationActionIdentifier()) {
    return;
  }

  // Task reminder actions use the per-alert action token issued by the backend.
  if (actionIdentifier === "complete" || actionIdentifier === "snooze-1h") {
    if (payload.token) {
      await applyNotificationAction(payload.token, actionIdentifier);
    }
    return;
  }

  // Admin approval actions use the user's JWT against the existing admin endpoints.
  if (actionIdentifier === "approve" || actionIdentifier === "reject") {
    if (!authToken || !payload.requesterId || !payload.taskId) {
      return;
    }
    if (actionIdentifier === "approve") {
      await approveTaskRequest(authToken, payload.requesterId, payload.taskId);
    } else {
      // Notification UI cannot collect a reason — record the reject with a neutral note.
      await rejectTaskRequest(authToken, payload.requesterId, payload.taskId, "Bildirimden reddedildi");
    }
  }
}
