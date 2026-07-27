import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AppHeader } from "@/components/app-header";
import { Card, Chip, EmptyState, PrimaryButton, Screen, StatTile, colors } from "@/components/ui";
import { SheetModal } from "@/components/sheet-modal";
import { TaskCard } from "@/components/task-card";
import { createRoute, markRouteStopVisited, startRoute } from "@/lib/api";
import { useAppData } from "@/lib/app-data-context";
import { useAuth } from "@/lib/auth-context";
import { companyById, getEffectiveTaskStatus, sortByDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ErrandGeofenceInput } from "@/lib/geofencing";
import { canRouteToCompany, formatDistanceLabel, hasUsableCoordinates, openCompanyRoute, openMultiCompanyRoute } from "@/lib/location";
import { useUserLocation } from "@/lib/location-context";
import { buildRoutePayloadFromPlan, buildTodayRoutePlan, describeRouteExclusion } from "@/lib/today-route";
import type { ErrandMatch, RoutePlan, UserLocationCoordinates } from "@/types/business";
import {
  findTaskOpportunities,
  MAX_TASK_OPPORTUNITY_REGIONS,
  ON_THE_WAY_BUFFER_METERS
} from "@/lib/route-opportunities";
import { persistTaskOpportunities } from "@/lib/geofencing";
import { todayKeyLocal } from "@/lib/geofence-throttle-state";
import type { RouteOpportunity } from "@/types/business";
import { RouteMap } from "@/components/route-map";

export default function RoutePlannerScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { data, acknowledgeTask, markTaskDone, snoozeTask, updateTask, cancelTask, addTaskNote, fetchRouteErrands, registerErrandGeofences } =
    useAppData();
  const { state: locationState, refreshLocation, requestPermission } = useUserLocation();
  const { t } = useI18n();
  // R12 — server-tracked route: the route saved via POST /routes (with server stop ids)
  // and the set of stops already marked as visited.
  const [savedRoute, setSavedRoute] = useState<RoutePlan | null>(null);
  const [visitedStopIds, setVisitedStopIds] = useState<Set<string>>(new Set());
  const [visitingStopId, setVisitingStopId] = useState<string | null>(null);
  // "Yola çıkmadan önce" — shops on the way that sell an open shopping-list errand.
  const [errandMatches, setErrandMatches] = useState<ErrandMatch[]>([]);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);

  // `now` bir referans olarak stabil kalmalı: her render'da yeni bir Date, altındaki
  // useMemo zincirini (todayRouteSourceTasks → todayRoutePlan → corridor →
  // taskOpportunities, ve fieldTasks) her render'da geçersiz kılar. Dakika taneli
  // bir anahtar üretip Date'i yalnızca o anahtar değiştiğinde yeniden kuruyoruz —
  // geciken görev hesabı (getEffectiveTaskStatus) hâlâ dakika hassasiyetinde kalır.
  const rawNow = new Date();
  const nowMinuteKey = `${rawNow.getFullYear()}-${rawNow.getMonth()}-${rawNow.getDate()}-${rawNow.getHours()}-${rawNow.getMinutes()}`;
  const now = useMemo(() => new Date(), [nowMinuteKey]);
  const todayKey = now.toISOString().slice(0, 10);

  // Today's open tasks — same source as today.tsx & index.tsx, so all three
  // screens stay perfectly in sync.
  const todayRouteSourceTasks = useMemo(
    () => sortByDateTime(
      data.tasks.filter((item) => item.dueDate === todayKey && getEffectiveTaskStatus(item, now) !== "done")
    ),
    [data.tasks, now, todayKey]
  );

  const todayRoutePlan = useMemo(
    () => buildTodayRoutePlan(todayRouteSourceTasks, data.companies, locationState.coords),
    [data.companies, locationState.coords, todayRouteSourceTasks]
  );

  // Koridor: konum + bugünün durakları. Konum yoksa yalnızca duraklardan kurulur.
  const corridor = useMemo(() => {
    const points: Array<{ latitude: number; longitude: number }> = [];
    if (locationState.coords) points.push(locationState.coords);
    for (const stop of todayRoutePlan.stops) {
      if (hasUsableCoordinates(stop.company)) {
        points.push({ latitude: stop.company.latitude, longitude: stop.company.longitude });
      }
    }
    return points;
  }, [locationState.coords, todayRoutePlan.stops]);

  // Görev fırsatları tamamen yerel — ağ beklemeden anında hazır.
  const taskOpportunities = useMemo(() => {
    if (!corridor.length) return [];
    return findTaskOpportunities({
      tasks: data.tasks.filter((task) => task.status !== "done" && Boolean(task.companyId)),
      companies: data.companies,
      corridor,
      bufferMeters: corridor.length > 1 ? ON_THE_WAY_BUFFER_METERS : null,
      excludeCompanyIds: [
        ...todayRoutePlan.stops.map((stop) => stop.company.id),
        ...todayRouteSourceTasks.map((task) => task.companyId).filter((id): id is string => Boolean(id))
      ],
      limit: MAX_TASK_OPPORTUNITY_REGIONS
    });
  }, [corridor, data.companies, data.tasks, todayRoutePlan.stops, todayRouteSourceTasks]);

  const opportunities = useMemo<RouteOpportunity[]>(() => {
    const taskRows: RouteOpportunity[] = taskOpportunities.map((item) => ({
      id: `task:${item.companyId}`,
      kind: "task",
      title: item.companyName,
      subtitle: item.taskCount > 1 ? `${item.taskCount} açık iş` : item.taskTitle,
      latitude: item.latitude,
      longitude: item.longitude,
      distanceMeters: item.distanceToRouteMeters,
      companyId: item.companyId,
      taskId: item.taskId
    }));
    const errandRows: RouteOpportunity[] = errandMatches.map((match) => ({
      id: `errand:${match.itemId}:${match.latitude},${match.longitude}`,
      kind: "errand",
      title: match.shopName,
      subtitle: match.itemName,
      latitude: match.latitude,
      longitude: match.longitude,
      distanceMeters: match.distanceToRouteMeters
    }));
    return [...taskRows, ...errandRows];
  }, [errandMatches, taskOpportunities]);

  const selectedOpportunity = opportunities.find((item) => item.id === selectedOpportunityId) ?? null;

  // Field tasks pool (the candidate list shown below the route) — open and
  // route-shaped (visits/installation/support/measurements/delivery).
  const fieldTasks = useMemo(
    () => data.tasks.filter(
      (task) =>
        getEffectiveTaskStatus(task, now) !== "done" &&
        ["visits", "installation", "support", "measurements", "delivery"].includes(task.type)
    ),
    [data.tasks, now]
  );

  const excludedNames = Array.from(new Set(todayRoutePlan.excludedTasks.map((item) => item.task.title)))
    .slice(0, 3)
    .join(", ");
  const firstStop = todayRoutePlan.stops[0] ?? null;
  const firstStopTime = firstStop?.tasks
    .slice()
    .sort((left, right) => {
      const leftDate = `${left.dueDate ?? "9999-12-31"}T${left.dueTime ?? "23:59"}`;
      const rightDate = `${right.dueDate ?? "9999-12-31"}T${right.dueTime ?? "23:59"}`;
      return leftDate.localeCompare(rightDate);
    })[0]?.dueTime ?? null;

  // Rota başlatıldığında: görev fırsatları (yerel, anında) diske yazılır ve
  // geofence olarak kurulur; alışveriş dükkanları ağdan gelir ve Google Maps'i
  // hiçbir koşulda geciktirmez.
  async function loadRouteOpportunities(origin: UserLocationCoordinates | null) {
    try {
      // Depoyu okuyan taraf (geofencing.ts) YEREL gün anahtarı kullanıyor; buradaki
      // ekran içi `todayKey` ise UTC tabanlı. Aynı saf yardımcıyı kullanarak gece
      // yarısından sonra fırsatların sessizce düşmesini engelliyoruz.
      const localTodayKey = todayKeyLocal(new Date());
      await persistTaskOpportunities({ date: localTodayKey, source: "route", items: taskOpportunities });

      const coords: Array<[number, number]> = [];
      if (origin) coords.push([origin.latitude, origin.longitude]);
      for (const stop of todayRoutePlan.stops) {
        const company = stop.company;
        if (hasUsableCoordinates(company)) coords.push([company.latitude, company.longitude]);
      }
      if (!coords.length) return;

      const matches = await fetchRouteErrands(coords);
      const errands: ErrandGeofenceInput[] = matches.map((match) => ({
        itemId: match.itemId,
        itemName: match.itemName,
        companyId: `errand:${match.itemId}:${match.latitude},${match.longitude}`,
        companyName: match.shopName,
        latitude: match.latitude,
        longitude: match.longitude
      }));
      await registerErrandGeofences(errands);

      if (matches.length) {
        setErrandMatches(matches);
      }
    } catch {
      // Best-effort — fırsat kontrolü rota başlatmayı asla bozmamalı.
    }
  }

  async function handleStartTodayRoute() {
    try {
      if (!todayRoutePlan.stops.length) return;

      let nextCoords = locationState.coords;
      if (!nextCoords && locationState.canAskAgain && locationState.status !== "denied") {
        await requestPermission();
        nextCoords = locationState.coords;
      }
      if (!nextCoords && locationState.granted) {
        await refreshLocation();
        nextCoords = locationState.coords;
      }

      // Save + start the route server-side (best-effort) BEFORE handing over to Google
      // Maps, so per-stop visit tracking has server ids to hit.
      if (token) {
        try {
          let route = savedRoute;
          if (!route) {
            const payload = buildRoutePayloadFromPlan(todayRoutePlan, nextCoords ?? null, todayKey, "manual");
            route = await createRoute(token, { ...payload, status: "planned" });
            setSavedRoute(route);
          }
          if (route?.id) {
            const started = await startRoute(token, route.id).catch(() => null);
            if (started) setSavedRoute(started);
          }
        } catch {
          // Server-side tracking is best-effort; navigation must still open.
        }
      }

      // Kick off the along-the-route errand check in parallel — must not delay navigation.
      void loadRouteOpportunities(nextCoords ?? null);

      await openMultiCompanyRoute(todayRoutePlan.stops.map((stop) => stop.company), nextCoords ?? null);

      if (todayRoutePlan.excludedTasks.length) {
        Alert.alert(
          "Rota uyarisi",
          `${todayRoutePlan.excludedTasks.length} gorev rotaya eklenmedi (${describeRouteExclusion(todayRoutePlan.excludedTasks[0]!.reason)}): ${excludedNames}`
        );
      }
    } catch (error) {
      Alert.alert("Rota acilamadi", error instanceof Error ? error.message : "Google Maps rotasi baslatilamadi.");
    }
  }

  async function handleMarkStopVisited(companyId: string) {
    if (!token || !savedRoute?.id) return;
    const serverStop = savedRoute.stops.find((stop) => stop.companyId === companyId);
    if (!serverStop || visitedStopIds.has(serverStop.id) || visitingStopId) return;
    setVisitingStopId(serverStop.id);
    try {
      await markRouteStopVisited(token, savedRoute.id, serverStop.id);
      setVisitedStopIds((current) => new Set(current).add(serverStop.id));
    } catch (error) {
      Alert.alert("Kaydedilemedi", error instanceof Error ? error.message : "Durak ziyareti isaretlenemedi.");
    } finally {
      setVisitingStopId(null);
    }
  }

  return (
    <Screen withTabs>
      <AppHeader title="Rota plani" subtitle="Bugun gunluk gorevlerden olusan canli rotani plania, eksik adresleri an be an gor." />

      <View style={styles.statsGrid}>
        <StatTile label="Durak" value={todayRoutePlan.stops.length} accent={colors.primary} />
        <StatTile label="Saha gorevi" value={fieldTasks.length} accent={colors.text} />
        <StatTile label="Ilk durak saati" value={firstStopTime ?? "-"} accent={colors.warning} />
        <StatTile
          label="Rotaya eklenmedi"
          value={todayRoutePlan.excludedTasks.length}
          accent={todayRoutePlan.excludedTasks.length ? colors.danger : colors.success}
        />
      </View>

      <Card variant="hero" style={styles.heroCard}>
        <Text style={styles.heroTitle}>{todayRoutePlan.stops.length ? "Bugun rotasi hazir" : "Bugun rotasi yok"}</Text>
        <Text style={styles.heroText}>
          {todayRoutePlan.stops.length
            ? `Bugun icin ${todayRoutePlan.stops.length} duraktan olusan rotayi tek dokunusla Google Maps'te ac.`
            : "Bugune tarihli, adresi bulunan acik gorev olunca buradan rotayi baslatabilirsin."}
        </Text>
        <PrimaryButton
          label={todayRoutePlan.stops.length ? "Rotayi baslat" : "Rota yok"}
          onPress={() => void handleStartTodayRoute()}
          disabled={!todayRoutePlan.stops.length}
        />
      </Card>

      <Card>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{t("route.onTheWay.title")}</Text>
          <Chip
            label={`${opportunities.length}`}
            tone={opportunities.length ? "success" : "default"}
          />
        </View>
        <Text style={styles.sectionHint}>{t("route.onTheWay.subtitle")}</Text>
        <RouteMap
          origin={locationState.coords ?? null}
          stops={todayRoutePlan.stops.map((stop) => ({
            name: stop.company.name,
            latitude: stop.company.latitude,
            longitude: stop.company.longitude
          }))}
          opportunities={opportunities}
          onSelectOpportunity={(id) => setSelectedOpportunityId(id)}
        />
        {opportunities.length === 0 ? (
          <EmptyState title={t("route.onTheWay.empty")} description={t("route.onTheWay.subtitle")} />
        ) : (
          opportunities.map((item) => (
            <Pressable key={item.id} onPress={() => setSelectedOpportunityId(item.id)} style={styles.errandRow}>
              <View style={styles.errandIcon}>
                <Feather
                  name={item.kind === "task" ? "briefcase" : "shopping-bag"}
                  size={16}
                  color={colors.primaryDark}
                />
              </View>
              <View style={styles.errandCopy}>
                <Text style={styles.errandTitle}>
                  {item.title} — {item.subtitle}
                </Text>
                <Text style={styles.errandMeta}>
                  {t(item.kind === "task" ? "route.onTheWay.tasks" : "route.onTheWay.errands")} ·{" "}
                  {formatDistanceLabel(item.distanceMeters) ?? "?"} {t("route.onTheWay.offRoute")}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.subtle} />
            </Pressable>
          ))
        )}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Optimum durak sirasi</Text>
        <Text style={styles.sectionHint}>Bugunun gorevlerinden anlik olusturulan rota</Text>
        {todayRoutePlan.stops.length === 0 ? (
          <EmptyState
            title="Bugun rota durak yok"
            description="Bugune tarihli acik gorev ve adres tanimli firma birikince siralanmis rota burada gozukur."
          />
        ) : (
          todayRoutePlan.stops.map((stop, index) => {
            const company = stop.company;
            const stopNumber = index + 1;
            const nextTask = stop.tasks
              .slice()
              .sort((left, right) => {
                const leftDate = `${left.dueDate ?? "9999-12-31"}T${left.dueTime ?? "23:59"}`;
                const rightDate = `${right.dueDate ?? "9999-12-31"}T${right.dueTime ?? "23:59"}`;
                return leftDate.localeCompare(rightDate);
              })[0];
            const distanceLabel = formatDistanceLabel(stop.distanceMeters ?? undefined) ?? "Saat sirasiyla";
            const timeLabel = nextTask?.dueTime
              ? `Ilk gorev ${nextTask.dueTime}`
              : "Saat bilgisi yok";
            const serverStop = savedRoute?.stops.find((item) => item.companyId === company.id) ?? null;
            const isVisited = Boolean(serverStop && visitedStopIds.has(serverStop.id));

            return (
              <Pressable
                key={company.id}
                onPress={() => router.push({ pathname: "/(app)/companies/[id]", params: { id: company.id } })}
                style={styles.stopRow}
              >
                <View style={[styles.stopBadge, isVisited && styles.stopBadgeVisited]}>
                  {isVisited ? (
                    <Feather name="check" size={16} color={colors.success} />
                  ) : (
                    <Text style={styles.stopBadgeText}>{stopNumber}</Text>
                  )}
                </View>
                <View style={styles.stopCopy}>
                  <Text style={styles.stopTitle}>{company.name}</Text>
                  <Text style={styles.stopMeta}>{timeLabel} · {distanceLabel}</Text>
                </View>
                {serverStop && !isVisited ? (
                  <Pressable
                    onPress={() => void handleMarkStopVisited(company.id)}
                    style={[styles.visitedButton, visitingStopId === serverStop.id && { opacity: 0.5 }]}
                    disabled={visitingStopId === serverStop.id}
                  >
                    <Text style={styles.visitedButtonText}>Vardım ✓</Text>
                  </Pressable>
                ) : null}
                {canRouteToCompany(company) ? (
                  <Pressable
                    onPress={() => void openCompanyRoute(company, locationState.coords)}
                    style={styles.routeIconButton}
                  >
                    <Feather name="map-pin" size={16} color={colors.primaryDark} />
                  </Pressable>
                ) : (
                  <Feather name="chevron-right" size={18} color={colors.subtle} />
                )}
              </Pressable>
            );
          })
        )}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Rota adayi saha gorevleri</Text>
        <Text style={styles.sectionHint}>Acik ziyaret, kurulum, destek, olcum ve teslim gorevleri</Text>
        {fieldTasks.length === 0 ? (
          <EmptyState title="Saha gorevi yok" description="Rota gerektiren yeni gorevler geldiginde burada listelenecek." />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.taskRail}>
            {fieldTasks.slice(0, 6).map((task) => (
              <View key={task.id} style={styles.taskRailCard}>
                <TaskCard
                  task={task}
                  company={task.companyId ? companyById(data.companies, task.companyId) : undefined}
                  onDone={(note) => markTaskDone(task, note)}
                onReschedule={(date, time) => updateTask({ ...task, dueDate: date, dueTime: time, status: "open", notificationsEnabled: true })}
                  onSnooze={(hours, reason) => snoozeTask(task, hours, reason)}
                  onAcknowledge={() => acknowledgeTask(task.id)}
                  onCancel={() => cancelTask(task.id)}
                  onAddNote={(content) => addTaskNote(task, content)}
                  onOpenRoute={
                    task.companyId && canRouteToCompany(companyById(data.companies, task.companyId))
                      ? () => openCompanyRoute(companyById(data.companies, task.companyId)!, locationState.coords)
                      : undefined
                  }
                />
              </View>
            ))}
          </ScrollView>
        )}
      </Card>

      <Card>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Rotaya eklenmeyen gorevler</Text>
          <Chip
            label={`${todayRoutePlan.excludedTasks.length} eksik`}
            tone={todayRoutePlan.excludedTasks.length ? "danger" : "success"}
          />
        </View>
        <Text style={styles.sectionHint}>
          Bugunun listesinden cikartilan gorevler — cogu adres veya firma eksik oldugu icin
        </Text>
        {todayRoutePlan.excludedTasks.length === 0 ? (
          <EmptyState
            title="Hepsi yolda"
            description="Bugunun butun gorevleri rota uzerinde — eksik adres veya firma yok."
          />
        ) : (
          todayRoutePlan.excludedTasks.map((item) => {
            const company = item.task.companyId ? companyById(data.companies, item.task.companyId) : null;
            return (
              <View key={item.task.id} style={styles.addressRow}>
                <Feather name="alert-triangle" size={16} color={colors.danger} />
                <View style={styles.addressCopy}>
                  <Text style={styles.addressTitle}>{item.task.title}</Text>
                  <Text style={styles.addressMeta}>
                    {company?.name ?? "Kisisel gorev"} · {describeRouteExclusion(item.reason)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </Card>

      <SheetModal
        visible={Boolean(selectedOpportunity)}
        title={selectedOpportunity?.title ?? ""}
        subtitle={selectedOpportunity?.subtitle}
        onClose={() => setSelectedOpportunityId(null)}
      >
        <Text style={styles.errandMeta}>
          {formatDistanceLabel(selectedOpportunity?.distanceMeters) ?? "?"} {t("route.onTheWay.offRoute")}
        </Text>
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12
  },
  heroCard: {
    borderColor: colors.border
  },
  heroTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: -0.3
  },
  heroText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800"
  },
  sectionHint: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 3
  },
  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  stopBadge: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center"
  },
  stopBadgeText: {
    color: colors.primaryDark,
    fontSize: 15,
    fontWeight: "800"
  },
  stopBadgeVisited: {
    backgroundColor: "rgba(63,155,120,0.14)"
  },
  visitedButton: {
    minHeight: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(63,155,120,0.4)",
    backgroundColor: "rgba(63,155,120,0.10)",
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center"
  },
  visitedButtonText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "700"
  },
  stopCopy: {
    flex: 1,
    gap: 4
  },
  stopTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700"
  },
  stopMeta: {
    color: colors.muted,
    fontSize: 13
  },
  routeIconButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center"
  },
  taskRail: {
    gap: 12,
    paddingRight: 6
  },
  taskRailCard: {
    width: 324
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  addressCopy: {
    flex: 1,
    gap: 4
  },
  addressTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  addressMeta: {
    color: colors.muted,
    fontSize: 13
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    paddingHorizontal: 20
  },
  modalCard: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 12,
    maxHeight: "78%"
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  modalSubtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: -6
  },
  modalList: {
    flexGrow: 0
  },
  modalListContent: {
    gap: 12
  },
  errandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  errandIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center"
  },
  errandCopy: {
    flex: 1,
    gap: 2
  },
  errandTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  errandMeta: {
    color: colors.muted,
    fontSize: 13
  }
});
