"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ClipboardList, Clock3, Map, Route } from "lucide-react";
import { getTodayTasks, useAppState } from "@/lib/app-state";
import { buildTodayRoutePlan, describeRouteExclusion, type TodayRouteExcludedTask } from "@/lib/today-route";
import {
  defaultBrowserLocationState,
  formatDistanceLabel,
  hasRouteDestination,
  openCompanyRoute,
  openMultiCompanyRoute,
  requestBrowserLocation,
  type BrowserLocationState
} from "@/lib/web-location";
import type { LanguageCode } from "@/types/business";
import { Badge, Button, Card, EmptyState, PageHeader, SectionTitle, StatCard, TaskCard } from "@/components/ui/ui-kit";

function formatRouteExclusionMessage(excludedTasks: TodayRouteExcludedTask[], language: LanguageCode) {
  if (!excludedTasks.length) {
    return null;
  }

  const names = Array.from(new Set(excludedTasks.map((item) => item.task.title))).slice(0, 3);
  const suffix = excludedTasks.length > names.length ? "..." : "";
  const label = names.join(", ");

  if (language === "tr") {
    return `${excludedTasks.length} gorev rotaya eklenmedi (${describeRouteExclusion(excludedTasks[0]!.reason)}): ${label}${suffix}`;
  }

  return `${excludedTasks.length} tasks were excluded from the route (${describeRouteExclusion(excludedTasks[0]!.reason)}): ${label}${suffix}`;
}

export function RoutePlannerPage() {
  const { data, t, language } = useAppState();
  const [locationState, setLocationState] = useState<BrowserLocationState>(defaultBrowserLocationState);
  const routeEligibleTasks = getTodayTasks(data);
  const todayRoutePlan = useMemo(
    () => buildTodayRoutePlan(routeEligibleTasks, data.companies, locationState.coordinates),
    [data.companies, locationState.coordinates, routeEligibleTasks]
  );
  const firstRouteCompany = todayRoutePlan.stops[0]?.company ?? null;
  const routeSummaryMessage = formatRouteExclusionMessage(todayRoutePlan.excludedTasks, language);

  async function startTodayRoute() {
    let nextState = locationState;
    if (locationState.status === "idle") {
      nextState = await requestBrowserLocation();
      setLocationState(nextState);
    }

    const nextPlan = buildTodayRoutePlan(routeEligibleTasks, data.companies, nextState.coordinates);
    if (!nextPlan.stops.length) {
      return;
    }

    openMultiCompanyRoute(nextPlan.stops.map((stop) => stop.company), nextState.coordinates);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("routePlanner.title")}
        subtitle={t("routePlanner.subtitle")}
        action={
          <Button onClick={() => void startTodayRoute()} disabled={!todayRoutePlan.stops.length}>
            <Route size={16} />
            {language === "tr" ? "Rotayi baslat" : "Start route"}
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="min-h-[420px]">
          <SectionTitle title={t("routePlanner.mapPlaceholder")} icon={Map} />
          <div className="relative min-h-[330px] overflow-hidden rounded-2xl border border-[#E8DECF] bg-[#F1E7D8] dark:border-darkBorder dark:bg-[#24211F]">
            <div className="absolute inset-6 rounded-[2rem] border border-primary/15" />
            {todayRoutePlan.stops.map((stop, index) => {
              const company = stop.company;
              const stopNumber = index + 1;
              return (
                <div
                  key={company.id}
                  className="absolute flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white shadow-premium dark:bg-darkPrimary"
                  style={{ left: `${18 + index * 26}%`, top: `${22 + (index % 2) * 34}%` }}
                >
                  {stopNumber}
                  <span className="absolute top-14 whitespace-nowrap rounded-full bg-white px-2 py-1 text-xs text-text shadow-sm dark:bg-[#1F1F1F] dark:text-[#F5F0EA]">
                    {company.name}
                  </span>
                </div>
              );
            })}
            {!todayRoutePlan.stops.length ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted dark:text-darkMuted">
                {t("empty.noTasks")}
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!firstRouteCompany || !hasRouteDestination(firstRouteCompany)}
              onClick={() => firstRouteCompany && openCompanyRoute(firstRouteCompany)}
            >
              {t("actions.openInGoogleMaps")}
            </Button>
            <Button variant="ghost">{t("actions.markVisited")}</Button>
            <Button variant="ghost">{t("actions.addVisitNote")}</Button>
            <Button variant="ghost">{t("actions.snoozeVisit")}</Button>
          </div>
        </Card>
        <div className="space-y-5">
          <Card>
            <SectionTitle title={t("routePlanner.optimizedOrder")} icon={ClipboardList} />
            <div className="space-y-3">
              {todayRoutePlan.stops.map((stop, index) => {
                const company = stop.company;
                const stopNumber = index + 1;
                const nextTask = stop.tasks
                  .slice()
                  .sort((left, right) => {
                    const leftDate = `${left.dueDate ?? "9999-12-31"}T${left.dueTime ?? "23:59"}`;
                    const rightDate = `${right.dueDate ?? "9999-12-31"}T${right.dueTime ?? "23:59"}`;
                    return leftDate.localeCompare(rightDate);
                  })[0];
                const distanceLabel = formatDistanceLabel(stop.distanceMeters ?? undefined)
                  ?? (language === "tr" ? "Saat sirasiyla" : "Ordered by time");
                const subtitle = nextTask?.dueTime
                  ? language === "tr"
                    ? `Ilk gorev ${nextTask.dueTime}`
                    : `First task ${nextTask.dueTime}`
                  : language === "tr"
                    ? "Saat bilgisi yok"
                    : "No time set";

                return (
                  <Link
                    href={`/companies/${company.id}`}
                    key={company.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#E8DECF] bg-white p-3 dark:border-darkBorder dark:bg-[#202020]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-beige text-primary dark:bg-[#2A2022] dark:text-darkPrimary">
                        {stopNumber}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-text dark:text-[#F5F0EA]">{company.name}</span>
                        <span className="block text-sm text-muted dark:text-darkMuted">{subtitle}</span>
                      </span>
                    </span>
                    <Badge>{distanceLabel}</Badge>
                  </Link>
                );
              })}
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label={t("routePlanner.totalDistance")} value={`${todayRoutePlan.stops.length} ${language === "tr" ? "durak" : "stops"}`} icon={Map} />
            <StatCard label={t("routePlanner.totalDuration")} value={routeSummaryMessage ?? (language === "tr" ? "Hazir" : "Ready")} icon={Clock3} />
          </div>
          <Card>
            <SectionTitle title={t("module.visits")} icon={CalendarClock} />
            <div className="space-y-3">
              {routeEligibleTasks.slice(0, 3).map((task) => (
                <TaskCard key={task.id} task={task} compact />
              ))}
            </div>
          </Card>
          <Card>
            <SectionTitle title={t("company.address")} subtitle={t("empty.noCompany")} icon={AlertTriangle} />
            <div className="space-y-3">
              {todayRoutePlan.excludedTasks.length
                ? todayRoutePlan.excludedTasks.map((item) => <TaskCard key={item.task.id} task={item.task} compact />)
                : <EmptyState title={t("empty.noTasks")} />}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
