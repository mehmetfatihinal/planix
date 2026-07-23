"use client";

import type { AiCaptureResponse, Company } from "@/types/business";

export interface BrowserLocationCoordinates {
  latitude: number;
  longitude: number;
}

export interface BrowserLocationState {
  status: "idle" | "granted" | "denied" | "unsupported" | "error";
  coordinates: BrowserLocationCoordinates | null;
  message: string | null;
}

export type ResolvedCompanyCandidate = NonNullable<NonNullable<AiCaptureResponse["companyResolution"]>["candidates"]>[number] & {
  distanceMeters?: number;
};

export function defaultBrowserLocationState(): BrowserLocationState {
  return {
    status: "idle",
    coordinates: null,
    message: null
  };
}

export async function requestBrowserLocation(): Promise<BrowserLocationState> {
  if (typeof window === "undefined" || !("geolocation" in navigator)) {
    return {
      status: "unsupported",
      coordinates: null,
      message: "Tarayıcı konum servisini desteklemiyor."
    };
  }

  return await new Promise<BrowserLocationState>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          status: "granted",
          coordinates: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          },
          message: null
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          resolve({
            status: "denied",
            coordinates: null,
            message: "Konum izni verilmedi. En yakin sube onerisi gosterilemeyecek."
          });
          return;
        }

        resolve({
          status: "error",
          coordinates: null,
          message: "Konum alinamadi. Adaylari adres bazli gostermeye devam ediyoruz."
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 8_000
      }
    );
  });
}

export function hasRouteDestination(company: Pick<Company, "address" | "latitude" | "longitude"> | Pick<ResolvedCompanyCandidate, "address" | "latitude" | "longitude">) {
  return hasUsableCoordinates(company.latitude, company.longitude) || Boolean(company.address?.trim());
}

export function rankResolutionCandidates(
  candidates: NonNullable<AiCaptureResponse["companyResolution"]>["candidates"],
  origin: BrowserLocationCoordinates | null
): ResolvedCompanyCandidate[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      distanceMeters:
        origin && hasUsableCoordinates(candidate.latitude, candidate.longitude)
          ? computeDistanceMeters(origin, { latitude: Number(candidate.latitude), longitude: Number(candidate.longitude) })
          : undefined
    }))
    .sort((left, right) => {
      const leftDistance = left.distanceMeters ?? Number.POSITIVE_INFINITY;
      const rightDistance = right.distanceMeters ?? Number.POSITIVE_INFINITY;
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      if (left.taskCount !== right.taskCount) return right.taskCount - left.taskCount;
      return left.name.localeCompare(right.name, "tr");
    });
}

export function formatDistanceLabel(distanceMeters?: number) {
  if (typeof distanceMeters !== "number" || Number.isNaN(distanceMeters) || distanceMeters < 0) {
    return null;
  }

  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(distanceMeters < 10_000 ? 1 : 0)} km`;
}

// Tarayıcılar, tıklama ile window.open arasına async bekleme (ör. konum izni)
// girdiğinde yeni sekmeyi popup sayıp engeller. Çözüm: sekme, tıklama anında
// SENKRON olarak boş açılır; Google Maps adresi async işler bitince bu sekmeye yazılır.
export function preopenExternalTab(): Window | null {
  if (typeof window === "undefined") return null;
  try {
    return window.open("about:blank", "_blank");
  } catch {
    return null;
  }
}

function openInTabOrNew(url: string, target?: Window | null) {
  if (target && !target.closed) {
    target.location.replace(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function openCompanyRoute(
  company: Pick<Company, "name" | "address" | "latitude" | "longitude"> | Pick<ResolvedCompanyCandidate, "name" | "address" | "latitude" | "longitude">,
  origin?: BrowserLocationCoordinates | null,
  target?: Window | null
) {
  const url = buildGoogleMapsUrl(company, origin);
  if (!url || typeof window === "undefined") {
    target?.close();
    return false;
  }
  openInTabOrNew(url, target);
  return true;
}

export function openMultiCompanyRoute(
  companies: Array<Pick<Company, "name" | "address" | "latitude" | "longitude">>,
  origin?: BrowserLocationCoordinates | null,
  target?: Window | null
) {
  const url = buildMultiStopGoogleMapsUrl(companies, origin);
  if (!url || typeof window === "undefined") {
    target?.close();
    return false;
  }
  openInTabOrNew(url, target);
  return true;
}

// Google Maps hedef metni. İsim + adres birlikte gönderilir: Google işletmeyi
// İSİMDEN tam POI olarak bulur, adres de şehir/mahalle bağlamını doğrular.
// Mahalle merkezine çözülen kaba koordinatları göndermek iki durağı aynı noktaya
// bindiriyordu ("KOTÇU UĞUR" vakası); koordinat yalnızca adres yokken kullanılır.
function buildDestinationQuery(
  company: Pick<Company, "name" | "address" | "latitude" | "longitude"> | Pick<ResolvedCompanyCandidate, "name" | "address" | "latitude" | "longitude">
) {
  const name = ("name" in company ? company.name : "")?.trim();
  const address = company.address?.trim();
  if (address) {
    return [name, address].filter(Boolean).join(", ");
  }
  if (hasUsableCoordinates(company.latitude, company.longitude)) {
    return `${company.latitude},${company.longitude}`;
  }
  return name || null;
}

function buildGoogleMapsUrl(
  company: Pick<Company, "name" | "address" | "latitude" | "longitude"> | Pick<ResolvedCompanyCandidate, "name" | "address" | "latitude" | "longitude">,
  origin?: BrowserLocationCoordinates | null
) {
  const base = "https://www.google.com/maps/dir/?api=1";
  const destination = buildDestinationQuery(company);

  if (!destination) return null;

  const params = new URLSearchParams({
    destination,
    travelmode: "driving"
  });

  if (origin) {
    params.set("origin", `${origin.latitude},${origin.longitude}`);
  }

  return `${base}&${params.toString()}`;
}

function buildMultiStopGoogleMapsUrl(
  companies: Array<Pick<Company, "name" | "address" | "latitude" | "longitude">>,
  origin?: BrowserLocationCoordinates | null
) {
  const destinations = companies
    .map((company) => buildDestinationQuery(company))
    .filter((value): value is string => Boolean(value));

  if (!destinations.length) return null;
  if (destinations.length === 1) {
    return buildGoogleMapsUrl(companies[0]!, origin);
  }

  const base = "https://www.google.com/maps/dir/?api=1";
  const params = new URLSearchParams({
    destination: destinations[destinations.length - 1]!,
    travelmode: "driving"
  });

  if (origin) {
    params.set("origin", `${origin.latitude},${origin.longitude}`);
  }

  const waypoints = destinations.slice(0, -1);
  if (waypoints.length) {
    params.set("waypoints", waypoints.join("|"));
  }

  return `${base}&${params.toString()}`;
}

function hasUsableCoordinates(latitude?: number | null, longitude?: number | null) {
  return typeof latitude === "number"
    && typeof longitude === "number"
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) > 0.000001
    && Math.abs(longitude) > 0.000001;
}

function computeDistanceMeters(origin: BrowserLocationCoordinates, destination: BrowserLocationCoordinates) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const deltaLatitude = toRadians(destination.latitude - origin.latitude);
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);
  const latitude1 = toRadians(origin.latitude);
  const latitude2 = toRadians(destination.latitude);

  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
