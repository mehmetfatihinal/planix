import type { Company, Task, UserLocationCoordinates } from "@/types/business";

export const MAX_ROUTE_STOPS = 10;

export type TodayRouteExclusionReason = "missingCompany" | "missingDestination" | "routeLimit";

export type TodayRouteExcludedTask = {
  task: Task;
  reason: TodayRouteExclusionReason;
};

export type TodayRouteStop = {
  company: Company;
  tasks: Task[];
  distanceMeters: number | null;
  firstDueSortKey: string;
};

export type TodayRoutePlan = {
  stops: TodayRouteStop[];
  excludedTasks: TodayRouteExcludedTask[];
  routeableTaskCount: number;
  routeableCompanyCount: number;
};

export function buildTodayRoutePlan(
  tasks: Task[],
  companies: Company[],
  origin: UserLocationCoordinates | null
): TodayRoutePlan {
  const excludedTasks: TodayRouteExcludedTask[] = [];
  const companyStops = new Map<string, TodayRouteStop>();

  for (const task of tasks) {
    if (task.status === "done") continue;

    if (!task.companyId) {
      excludedTasks.push({ task, reason: "missingCompany" });
      continue;
    }

    const company = companies.find((item) => item.id === task.companyId);
    if (!company) {
      excludedTasks.push({ task, reason: "missingCompany" });
      continue;
    }

    if (!hasRouteDestination(company)) {
      excludedTasks.push({ task, reason: "missingDestination" });
      continue;
    }

    const existing = companyStops.get(company.id);
    if (!existing) {
      companyStops.set(company.id, {
        company,
        tasks: [task],
        distanceMeters:
          origin && hasUsableCoordinates(company.latitude, company.longitude)
            ? computeDistanceMeters(origin, { latitude: company.latitude, longitude: company.longitude })
            : null,
        firstDueSortKey: buildTaskSortKey(task)
      });
      continue;
    }

    existing.tasks.push(task);
    const nextSortKey = buildTaskSortKey(task);
    if (nextSortKey < existing.firstDueSortKey) {
      existing.firstDueSortKey = nextSortKey;
    }
  }

  const sortedStops = [...companyStops.values()].sort((left, right) => {
    if (left.distanceMeters !== null && right.distanceMeters !== null && left.distanceMeters !== right.distanceMeters) {
      return left.distanceMeters - right.distanceMeters;
    }

    if (left.distanceMeters !== null && right.distanceMeters === null) return -1;
    if (left.distanceMeters === null && right.distanceMeters !== null) return 1;

    if (left.firstDueSortKey !== right.firstDueSortKey) {
      return left.firstDueSortKey.localeCompare(right.firstDueSortKey);
    }

    return left.company.name.localeCompare(right.company.name, "tr");
  });

  const routeableCompanyCount = sortedStops.length;
  const cappedStops = sortedStops.slice(0, MAX_ROUTE_STOPS);
  const omittedStops = sortedStops.slice(MAX_ROUTE_STOPS);
  for (const stop of omittedStops) {
    for (const task of stop.tasks) {
      excludedTasks.push({ task, reason: "routeLimit" });
    }
  }

  return {
    stops: cappedStops,
    excludedTasks,
    routeableTaskCount: cappedStops.reduce((sum, stop) => sum + stop.tasks.length, 0),
    routeableCompanyCount
  };
}

export function describeRouteExclusion(reason: TodayRouteExclusionReason) {
  switch (reason) {
    case "missingCompany":
      return "firma baglami yok";
    case "missingDestination":
      return "firma adresi veya konumu eksik";
    case "routeLimit":
      return "Google Maps durak limiti disinda kaldi";
    default:
      return "rotaya eklenemedi";
  }
}

// Serializes a built plan into the POST /routes payload. Distances between consecutive
// stops are haversine estimates; durations assume ~40 km/h field driving speed.
export function buildRoutePayloadFromPlan(
  plan: TodayRoutePlan,
  origin: UserLocationCoordinates | null,
  date: string,
  source: string
) {
  let previous: UserLocationCoordinates | null = origin;
  let totalMeters = 0;

  const stops = plan.stops.map((stop, index) => {
    const company = stop.company;
    const hasCoords = hasUsableCoordinates(company.latitude, company.longitude);
    const target: UserLocationCoordinates | null = hasCoords
      ? { latitude: company.latitude, longitude: company.longitude }
      : null;
    const meters = previous && target ? computeDistanceMeters(previous, target) : 0;
    totalMeters += meters;
    if (target) previous = target;

    return {
      companyId: company.id,
      order: index + 1,
      distanceFromPrevious: formatKilometers(meters),
      durationFromPrevious: formatDriveMinutes(meters)
    };
  });

  return {
    date,
    stops,
    totalDistance: formatKilometers(totalMeters),
    totalDuration: formatDriveMinutes(totalMeters),
    source
  };
}

function formatKilometers(meters: number) {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDriveMinutes(meters: number) {
  const minutes = Math.max(1, Math.round((meters / 1000 / 40) * 60));
  return `${minutes} dk`;
}

function buildTaskSortKey(task: Task) {
  const date = task.dueDate ?? "9999-12-31";
  const time = task.dueTime ?? "23:59";
  return `${date}T${time}`;
}

function hasRouteDestination(company: Pick<Company, "address" | "latitude" | "longitude">) {
  return hasUsableCoordinates(company.latitude, company.longitude) || Boolean(company.address?.trim());
}

function hasUsableCoordinates(latitude?: number | null, longitude?: number | null) {
  return typeof latitude === "number"
    && typeof longitude === "number"
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) > 0.000001
    && Math.abs(longitude) > 0.000001;
}

function computeDistanceMeters(
  origin: UserLocationCoordinates,
  destination: UserLocationCoordinates
) {
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
