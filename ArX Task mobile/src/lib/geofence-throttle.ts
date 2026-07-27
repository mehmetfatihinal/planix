import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  canNotify,
  normalizeState,
  todayKeyLocal,
  withMuted,
  withNotified,
  type GeofenceKind,
  type ThrottleState
} from "@/lib/geofence-throttle-state";

const THROTTLE_KEY = "arx:geofence-notified";

async function readState(): Promise<ThrottleState> {
  const todayKey = todayKeyLocal(new Date());
  try {
    const raw = await AsyncStorage.getItem(THROTTLE_KEY);
    return normalizeState(raw ? (JSON.parse(raw) as ThrottleState) : null, todayKey);
  } catch {
    return normalizeState(null, todayKey);
  }
}

async function writeState(state: ThrottleState) {
  try {
    await AsyncStorage.setItem(THROTTLE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort — kısıtlama kaybı bildirimi engellemekten iyidir.
  }
}

export async function shouldNotify(regionId: string, kind: GeofenceKind): Promise<boolean> {
  const state = await readState();
  return canNotify(state, regionId, kind, Date.now());
}

export async function markNotified(regionId: string): Promise<void> {
  const state = await readState();
  await writeState(withNotified(state, regionId, Date.now()));
}

export async function muteRegionForToday(regionId: string): Promise<void> {
  const state = await readState();
  await writeState(withMuted(state, regionId, Date.now()));
}
