// Yol üzeri fırsat mantığı. BU DOSYA SAF TUTULMALI: çalışma zamanı importu yok,
// yalnızca `import type`. Birim testleri Expo/React Native olmadan çalışır.

export type Coordinate = { latitude: number; longitude: number };
export type Corridor = Coordinate[];

const EARTH_RADIUS_METERS = 6_371_000;

export function hasUsableCoordinates(latitude?: number | null, longitude?: number | null) {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) > 0.000001 &&
    Math.abs(longitude) > 0.000001
  );
}

export function haversineMeters(origin: Coordinate, destination: Coordinate) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(destination.latitude - origin.latitude);
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);
  const latitude1 = toRadians(origin.latitude);
  const latitude2 = toRadians(destination.latitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type PlanarPoint = { x: number; y: number };

// Ekvatoral izdüşüm: referans enlemde metreye çevirir. Şehir içi mesafelerde
// hata payı ihmal edilebilir; segment matematiğini düzlemsel yapabilmek için.
function toPlanar(point: Coordinate, anchorLatitudeRadians: number): PlanarPoint {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  return {
    x: toRadians(point.longitude) * Math.cos(anchorLatitudeRadians) * EARTH_RADIUS_METERS,
    y: toRadians(point.latitude) * EARTH_RADIUS_METERS
  };
}

function distancePointToSegment(point: PlanarPoint, start: PlanarPoint, end: PlanarPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

// Bir noktanın, ardışık duraklardan oluşan çoklu-çizgiye en kısa mesafesi.
// Tek noktalı koridorda düz nokta-nokta mesafesine indirger.
export function distanceToCorridorMeters(point: Coordinate, corridor: Corridor): number {
  if (corridor.length === 0) return Number.POSITIVE_INFINITY;
  if (corridor.length === 1) return haversineMeters(point, corridor[0]!);

  const anchor = (point.latitude * Math.PI) / 180;
  const planarPoint = toPlanar(point, anchor);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < corridor.length - 1; index += 1) {
    const start = toPlanar(corridor[index]!, anchor);
    const end = toPlanar(corridor[index + 1]!, anchor);
    best = Math.min(best, distancePointToSegment(planarPoint, start, end));
  }
  return best;
}
