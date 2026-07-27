// Geofence bildirimlerinin tekrar kontrolü — SAF mantık. Çalışma zamanı importu yok.
// I/O sarmalayıcısı: geofence-throttle.ts

export type GeofenceKind = "company" | "task-opportunity" | "errand" | "seller";

export type ThrottleEntry = { lastNotifiedAt: number; muted: boolean };
export type ThrottleState = { date: string; entries: Record<string, ThrottleEntry> };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Bugünün görevi bugün bitmeli: sabah geçip yapmadıysan akşam tekrar hatırlatmak
// değerli. Yol üzeri fırsatların tarihi bugün değil — ikinci bildirim gürültü.
export const COOLDOWN_BY_KIND: Record<GeofenceKind, number> = {
  company: 4 * HOUR,
  "task-opportunity": DAY,
  errand: DAY,
  seller: DAY
};

export function todayKeyLocal(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function emptyState(todayKey: string): ThrottleState {
  return { date: todayKey, entries: {} };
}

export function normalizeState(state: ThrottleState | null, todayKey: string): ThrottleState {
  if (!state || state.date !== todayKey || typeof state.entries !== "object" || state.entries === null) {
    return emptyState(todayKey);
  }
  return state;
}

export function canNotify(
  state: ThrottleState,
  regionId: string,
  kind: GeofenceKind,
  nowMs: number
): boolean {
  const entry = state.entries[regionId];
  if (!entry) return true;
  if (entry.muted) return false;
  return nowMs - entry.lastNotifiedAt >= COOLDOWN_BY_KIND[kind];
}

export function withNotified(state: ThrottleState, regionId: string, nowMs: number): ThrottleState {
  const previous = state.entries[regionId];
  return {
    ...state,
    entries: {
      ...state.entries,
      [regionId]: { lastNotifiedAt: nowMs, muted: previous?.muted ?? false }
    }
  };
}

export function withMuted(state: ThrottleState, regionId: string, nowMs: number): ThrottleState {
  const previous = state.entries[regionId];
  return {
    ...state,
    entries: {
      ...state.entries,
      [regionId]: { lastNotifiedAt: previous?.lastNotifiedAt ?? nowMs, muted: true }
    }
  };
}
