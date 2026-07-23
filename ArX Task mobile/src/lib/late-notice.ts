import { Linking, Platform } from "react-native";
import { computeDistanceMeters } from "@/lib/location";
import type { UserLocationCoordinates } from "@/types/business";

// R16 — late bot travel-time estimation. OSRM public API first (5 s budget), haversine
// at 40 km/h as the offline fallback. Returns seconds.

const OSRM_TIMEOUT_MS = 5000;
const FALLBACK_SPEED_KMH = 40;

export async function estimateTravelSeconds(
  origin: UserLocationCoordinates,
  destination: UserLocationCoordinates
): Promise<number> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
    try {
      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}` +
        `?overview=false`;
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) {
        const payload = (await response.json()) as { routes?: Array<{ duration?: number }> };
        const duration = payload.routes?.[0]?.duration;
        if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0) {
          return duration;
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    // Timeout / network failure → fall through to haversine.
  }

  const meters = computeDistanceMeters(origin, destination);
  return (meters / 1000 / FALLBACK_SPEED_KMH) * 3600;
}

// Opens the platform SMS composer pre-filled with the message. Never sends by itself.
export async function openSmsComposer(phone: string, message: string) {
  const digits = phone.replace(/[^+\d]/g, "");
  const separator = Platform.OS === "ios" ? "&" : "?";
  await Linking.openURL(`sms:${digits}${separator}body=${encodeURIComponent(message)}`);
}

// Opens WhatsApp chat with the message pre-filled. Never sends by itself.
export async function openWhatsAppComposer(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  await Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`);
}
