import { Linking, Platform } from "react-native";
import * as ExpoLocation from "expo-location";
import type {
  AiCompanyResolutionCandidate,
  Company,
  UserLocationCoordinates,
  UserLocationState
} from "@/types/business";

const emptyLocationState: UserLocationState = {
  canAskAgain: true,
  granted: false,
  status: "unknown",
  coords: null,
  updatedAt: null,
  error: null
};

export function defaultLocationState() {
  return emptyLocationState;
}

export async function getLocationPermissionState() {
  const permission = await ExpoLocation.getForegroundPermissionsAsync();
  return {
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
    status: permission.status,
    coords: null,
    updatedAt: null,
    error: null
  } satisfies UserLocationState;
}

export async function requestLocationPermissionState() {
  const permission = await ExpoLocation.requestForegroundPermissionsAsync();
  return {
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
    status: permission.status,
    coords: null,
    updatedAt: null,
    error: null
  } satisfies UserLocationState;
}

export async function getCurrentUserLocation() {
  try {
    const current = await ExpoLocation.getCurrentPositionAsync({
      accuracy: ExpoLocation.Accuracy.Balanced
    });

    return {
      latitude: current.coords.latitude,
      longitude: current.coords.longitude
    } satisfies UserLocationCoordinates;
  } catch {
    const lastKnown = await ExpoLocation.getLastKnownPositionAsync();
    if (!lastKnown?.coords) {
      throw new Error("Canli konum alinamadi.");
    }

    return {
      latitude: lastKnown.coords.latitude,
      longitude: lastKnown.coords.longitude
    } satisfies UserLocationCoordinates;
  }
}

export function hasUsableCoordinates(value: { latitude?: number | null; longitude?: number | null } | null | undefined) {
  if (!value) return false;
  const latitude = value.latitude ?? null;
  const longitude = value.longitude ?? null;
  if (latitude === null || longitude === null) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return !(latitude === 0 && longitude === 0);
}

export function computeDistanceMeters(origin: UserLocationCoordinates, destination: UserLocationCoordinates) {
  const earthRadius = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = toRadians(destination.latitude - origin.latitude);
  const lonDelta = toRadians(destination.longitude - origin.longitude);
  const originLat = toRadians(origin.latitude);
  const destinationLat = toRadians(destination.latitude);

  const a =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(originLat) * Math.cos(destinationLat) * Math.sin(lonDelta / 2) * Math.sin(lonDelta / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadius * c);
}

export function formatDistanceLabel(distanceMeters: number | null | undefined) {
  if (distanceMeters === null || distanceMeters === undefined) return null;
  if (distanceMeters < 1000) return `${distanceMeters} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

export function rankResolutionCandidates(
  candidates: AiCompanyResolutionCandidate[],
  origin: UserLocationCoordinates | null
) {
  const enriched = candidates.map((candidate, index) => {
    const distanceMeters =
      origin && hasUsableCoordinates(candidate)
        ? computeDistanceMeters(origin, {
            latitude: candidate.latitude!,
            longitude: candidate.longitude!
          })
        : null;

    return {
      ...candidate,
      distanceMeters,
      originalIndex: index
    };
  });

  return enriched
    .sort((left, right) => {
      if (left.distanceMeters !== null && right.distanceMeters !== null) {
        return left.distanceMeters - right.distanceMeters;
      }
      if (left.distanceMeters !== null) return -1;
      if (right.distanceMeters !== null) return 1;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ originalIndex: _originalIndex, ...candidate }) => candidate);
}

export function canRouteToCompany(company: Company | null | undefined) {
  if (!company) return false;
  return hasUsableCoordinates(company) || Boolean(company.address?.trim());
}

// Google Maps hedef metni: isim + adres birlikte gönderilir; Google işletmeyi isimden
// tam POI olarak bulur. Mahalle merkezine çözülmüş kaba koordinatlar tüm durakları
// aynı noktaya bindirebildiği için koordinat yalnızca adres yokken kullanılır.
function buildDestinationQuery(company: Company): string | null {
  const name = company.name?.trim();
  const address = company.address?.trim();
  if (address) {
    return [name, address].filter(Boolean).join(", ");
  }
  if (hasUsableCoordinates(company)) {
    return `${company.latitude},${company.longitude}`;
  }
  return name || null;
}

export async function openCompanyRoute(company: Company, origin: UserLocationCoordinates | null) {
  const destination = buildDestinationQuery(company);

  if (!destination) {
    throw new Error("Firma icin rota acilacak konum veya adres bulunamadi.");
  }

  const originText = origin ? `${origin.latitude},${origin.longitude}` : null;
  const encodedDestination = encodeURIComponent(destination);
  const encodedOrigin = originText ? encodeURIComponent(originText) : null;

  const webUrl = originText
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodedOrigin}&destination=${encodedDestination}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}&travelmode=driving`;

  const nativeUrl =
    Platform.OS === "ios" && originText
      ? `comgooglemaps://?saddr=${encodedOrigin}&daddr=${encodedDestination}&directionsmode=driving`
      : null;

  if (nativeUrl && (await Linking.canOpenURL(nativeUrl))) {
    await Linking.openURL(nativeUrl);
    return;
  }

  await Linking.openURL(webUrl);
}

export async function openMultiCompanyRoute(companies: Company[], origin: UserLocationCoordinates | null) {
  const routable = companies
    .map((company) => ({ company, destination: buildDestinationQuery(company) }))
    .filter((entry): entry is { company: Company; destination: string } => Boolean(entry.destination));
  const destinations = routable.map((entry) => entry.destination);

  if (!destinations.length) {
    throw new Error("Bugun icin rota acilacak firma adresi bulunamadi.");
  }

  if (destinations.length === 1) {
    await openCompanyRoute(routable[0]!.company, origin);
    return;
  }

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

  await Linking.openURL(`https://www.google.com/maps/dir/?api=1&${params.toString()}`);
}
