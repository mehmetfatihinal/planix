// Yol üzeri fırsat mantığı. BU DOSYA SAF TUTULMALI: çalışma zamanı importu yok,
// yalnızca `import type`. Birim testleri Expo/React Native olmadan çalışır.

import type { Company, Task } from "@/types/business";

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

export type TaskSnapshot = Pick<Task, "id" | "title" | "companyId" | "dueDate" | "dueTime" | "status">;
export type CompanySnapshot = Pick<Company, "id" | "name" | "address" | "latitude" | "longitude">;

export type TaskOpportunity = {
  companyId: string;
  companyName: string;
  latitude: number;
  longitude: number;
  taskId: string;      // firmadaki en yakın vadeli görev
  taskTitle: string;
  taskCount: number;   // firmadaki açık görev sayısı
  distanceToRouteMeters: number;
};

export const ON_THE_WAY_BUFFER_METERS = 1000;
export const MAX_TASK_OPPORTUNITY_REGIONS = 6;
export const MAX_OPEN_TASK_SNAPSHOT = 300;

export function taskSortKey(task: Pick<TaskSnapshot, "dueDate" | "dueTime">) {
  return `${task.dueDate ?? "9999-12-31"}T${task.dueTime ?? "23:59"}`;
}

// Koridora yakın, açık görev taşıyan firmaları bulur. bufferMeters null ise
// mesafe filtresi uygulanmaz (rotasız gün: konuma en yakın N firma).
export function findTaskOpportunities(input: {
  tasks: TaskSnapshot[];
  companies: CompanySnapshot[];
  corridor: Corridor;
  bufferMeters: number | null;
  excludeCompanyIds: string[];
  limit: number;
}): TaskOpportunity[] {
  const { tasks, companies, corridor, bufferMeters, excludeCompanyIds, limit } = input;
  if (!corridor.length || limit <= 0) return [];

  const excluded = new Set(excludeCompanyIds);
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const groups = new Map<string, { company: CompanySnapshot; tasks: TaskSnapshot[] }>();

  for (const task of tasks) {
    if (task.status === "done" || !task.companyId) continue;
    if (excluded.has(task.companyId)) continue;
    const company = companyById.get(task.companyId);
    if (!company || !hasUsableCoordinates(company.latitude, company.longitude)) continue;
    const group = groups.get(company.id) ?? { company, tasks: [] };
    group.tasks.push(task);
    groups.set(company.id, group);
  }

  const opportunities: TaskOpportunity[] = [];
  for (const group of groups.values()) {
    const distance = distanceToCorridorMeters(
      { latitude: group.company.latitude, longitude: group.company.longitude },
      corridor
    );
    if (bufferMeters !== null && distance > bufferMeters) continue;
    const soonest = group.tasks
      .slice()
      .sort((left, right) => taskSortKey(left).localeCompare(taskSortKey(right)))[0]!;
    opportunities.push({
      companyId: group.company.id,
      companyName: group.company.name,
      latitude: group.company.latitude,
      longitude: group.company.longitude,
      taskId: soonest.id,
      taskTitle: soonest.title,
      taskCount: group.tasks.length,
      distanceToRouteMeters: Math.round(distance)
    });
  }

  opportunities.sort((left, right) =>
    left.distanceToRouteMeters !== right.distanceToRouteMeters
      ? left.distanceToRouteMeters - right.distanceToRouteMeters
      : left.companyName.localeCompare(right.companyName, "tr")
  );

  return opportunities.slice(0, limit);
}

// Evden çıkış özet bildiriminin metni. Rota veya fırsat yoksa mevcut
// metinler korunur (geofencing.ts:193, :226).
export function buildDepartureSummary(input: {
  stopCount: number;
  taskOpportunityCount: number;
  errandCount: number;
}): { title: string; body: string } {
  const { stopCount, taskOpportunityCount, errandCount } = input;
  const extras: string[] = [];
  if (taskOpportunityCount > 0) extras.push(`yol üzerinde ${taskOpportunityCount} iş`);
  if (errandCount > 0) extras.push(`${errandCount} alışveriş`);

  if (stopCount > 0) {
    return {
      title: "Günaydın! Bugünkü rotanız hazır",
      body: extras.length
        ? `${stopCount} durak · ${extras.join(", ")}`
        : `Bugünkü rotanız hazır — ${stopCount} durak`
    };
  }

  if (taskOpportunityCount > 0) {
    return {
      title: "Bugün planlı göreviniz yok",
      body: `Yakınınızda ${taskOpportunityCount} açık iş var`
    };
  }

  return { title: "Günaydın!", body: "Bugün planlı göreviniz yok." };
}
