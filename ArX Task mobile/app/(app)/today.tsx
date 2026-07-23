import { Fragment, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { AppHeader } from "@/components/app-header";
import { LateNoticeBanner } from "@/components/late-notice-banner";
import { EmptyState, Screen, StatTile, colors } from "@/components/ui";
import { TaskCard } from "@/components/task-card";
import { useAppData } from "@/lib/app-data-context";
import {
  companyById,
  getEffectiveTaskStatus,
  groupTasks,
  isTaskCompletedOn,
  isTaskOnToday,
  isTaskOpen,
  sortByDateTime
} from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useUserLocation } from "@/lib/location-context";
import { canRouteToCompany, openCompanyRoute, openMultiCompanyRoute } from "@/lib/location";
import { buildTodayRoutePlan, describeRouteExclusion } from "@/lib/today-route";

type ViewMode = "open" | "scheduled" | "overdue" | "completed";

export default function TodayScreen() {
  const { task: focusedTaskId, view } = useLocalSearchParams<{ task?: string; view?: string }>();
  const { data, acknowledgeTask, addTaskNote, cancelTask, markTaskDone, snoozeTask, updateTask, refresh, refreshing } = useAppData();
  const { t } = useI18n();
  const { state: locationState, refreshLocation, requestPermission } = useUserLocation();
  const [viewMode, setViewMode] = useState<ViewMode>("open");

  // Dashboard'tan ?view=completed|scheduled|overdue|open ile gelindiğinde sekmeyi senkronla.
  useEffect(() => {
    if (view && ["open", "scheduled", "overdue", "completed"].includes(view)) {
      setViewMode(view as ViewMode);
    }
  }, [view]);
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);

  // "Bugün" ekranı: filtrelerin hepsi bugüne göre. dueDate'i bugün olanlar +
  // dueDate'siz görevler (kullanıcı tarih demediyse bugün olduğu varsayılır)
  // burada toplanır; ileri tarihli görevler bu ekrana akmaz.
  const isOpenToday = (item: typeof data.tasks[number]) => isTaskOpen(item, now) && isTaskOnToday(item, now);
  const isScheduledToday = (item: typeof data.tasks[number]) =>
    isOpenToday(item) && Boolean(item.dueDate) && Boolean(item.dueTime);

  const tasks = useMemo(() => {
    const base = focusedTaskId
      ? data.tasks.filter((item) => item.id === focusedTaskId)
      : viewMode === "completed"
        ? data.tasks.filter((item) => isTaskCompletedOn(item, now))
        : viewMode === "overdue"
          ? data.tasks.filter((item) => getEffectiveTaskStatus(item, now) === "overdue")
        : viewMode === "scheduled"
          ? data.tasks.filter(isScheduledToday)
          : data.tasks.filter(isOpenToday);

    return sortByDateTime(base);
  }, [data.tasks, focusedTaskId, now, viewMode]);

  const groups = groupTasks(tasks, data.modules);
  const overdueCount = data.tasks.filter((item) => getEffectiveTaskStatus(item, now) === "overdue").length;
  const scheduledCount = data.tasks.filter(isScheduledToday).length;
  const openCount = data.tasks.filter(isOpenToday).length;
  const completedCount = data.tasks.filter((item) => isTaskCompletedOn(item, now)).length;
  const todayRouteSourceTasks = useMemo(
    () => sortByDateTime(data.tasks.filter((item) => item.dueDate === todayKey && getEffectiveTaskStatus(item, now) !== "done")),
    [data.tasks, now, todayKey]
  );
  const todayRoutePlan = useMemo(
    () => buildTodayRoutePlan(todayRouteSourceTasks, data.companies, locationState.coords),
    [data.companies, locationState.coords, todayRouteSourceTasks]
  );
  const excludedNames = Array.from(new Set(todayRoutePlan.excludedTasks.map((item) => item.task.title))).slice(0, 3).join(", ");

  async function handleStartTodayRoute() {
    try {
      if (!todayRoutePlan.stops.length) return;
      if (!locationState.coords && locationState.canAskAgain && locationState.status !== "denied") {
        await requestPermission();
      } else if (!locationState.coords && locationState.granted) {
        await refreshLocation();
      }

      await openMultiCompanyRoute(todayRoutePlan.stops.map((stop) => stop.company), locationState.coords);

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

  return (
    <Screen withTabs onRefresh={refresh} refreshing={refreshing}>
      <AppHeader title={t("today.title")} subtitle="Saha ziyaretleri, satış takipleri ve saat bazlı görevler." />

      <LateNoticeBanner />

      <View style={styles.statsGrid}>
        <StatTile label="Açık iş" value={openCount} accent={colors.text} />
        <StatTile label="Planlı" value={scheduledCount} accent={colors.primary} />
        <StatTile label="Geciken" value={overdueCount} accent={colors.danger} />
        <StatTile label="Tamamlanan" value={completedCount} accent={colors.success} />
      </View>

      <View style={styles.filterRow}>
        <FilterPill label="Açık" active={viewMode === "open"} onPress={() => setViewMode("open")} />
        <FilterPill label="Planlı" active={viewMode === "scheduled"} onPress={() => setViewMode("scheduled")} />
        <FilterPill label="Geciken" active={viewMode === "overdue"} onPress={() => setViewMode("overdue")} />
        <FilterPill label="Tamamlanan" active={viewMode === "completed"} onPress={() => setViewMode("completed")} />
      </View>

      <View style={styles.routeCard}>
        <View style={styles.routeHeader}>
          <Text style={styles.routeTitle}>Bugünün rota planı</Text>
          <Text style={styles.routeHint}>
            {todayRoutePlan.excludedTasks.length
              ? `${todayRoutePlan.excludedTasks.length} görev rotaya eklenmedi. ${excludedNames}`
              : todayRoutePlan.stops.length
                ? `${todayRoutePlan.stops.length} durak — firma bağlamlı görevlerden otomatik oluşturuldu.`
                : "Firma bağlamlı bugün görevlerinden çok duraklı rota oluştur."}
          </Text>
        </View>
        <Pressable onPress={() => void handleStartTodayRoute()} style={[styles.routeButton, !todayRoutePlan.stops.length && styles.routeButtonDisabled]} disabled={!todayRoutePlan.stops.length}>
          <Text style={styles.routeButtonText}>Rotayı başlat</Text>
        </Pressable>
      </View>

      {groups.length === 0 ? (
        <EmptyState
          title={
            viewMode === "completed" ? "Bugün henüz bir görev tamamlamadın"
            : viewMode === "overdue" ? "Geciken görev yok"
            : viewMode === "scheduled" ? "Bugün için planlı görev yok"
            : "Bugün için açık iş yok"
          }
          description={
            viewMode === "open"
              ? "Ses kutusundan yeni bir görev oluşturabilir veya 'Görevler' sekmesinden tüm görevlerini görebilirsin."
              : "Sekmeyi değiştirerek başka durumdaki görevleri görebilirsin."
          }
        />
      ) : (
        groups.map(([groupName, items]) => (
          <Fragment key={groupName}>
            <View style={styles.groupHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.groupTitle}>{groupName}</Text>
                <Text style={styles.groupHint}>{items.length} kayıt</Text>
              </View>
            </View>
            <View style={styles.groupList}>
              {items.map((task) => (
                (() => {
                  const company = companyById(data.companies, task.companyId);
                  return (
                    <TaskCard
                      key={task.id}
                      task={{ ...task, moduleIds: task.moduleIds.map((moduleId) => data.modules.find((item) => item.id === moduleId)?.name ?? moduleId) }}
                      company={company}
                      onDone={(note) => markTaskDone(task, note)}
                onReschedule={(date, time) => updateTask({ ...task, dueDate: date, dueTime: time, status: "open", notificationsEnabled: true })}
                      onSnooze={(hours, reason) => snoozeTask(task, hours, reason)}
                      onAcknowledge={() => acknowledgeTask(task.id)}
                      onAddNote={(content) => addTaskNote(task, content)}
                      onOpenRoute={company && canRouteToCompany(company) ? () => openCompanyRoute(company, locationState.coords) : undefined}
                      onCancel={async () => {
                        Alert.alert("Gorevi iptal et", "Bu kayit mobil listeden ve backend durumundan silinecek.", [
                          { text: "Vazgec", style: "cancel" },
                          { text: "Sil", style: "destructive", onPress: () => void cancelTask(task.id) }
                        ]);
                      }}
                    />
                  );
                })()
              ))}
            </View>
          </Fragment>
        ))
      )}
    </Screen>
  );
}

function FilterPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.filterPill, active && styles.filterPillActive]}>
      <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong
  },
  filterPillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  filterPillText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500"
  },
  filterPillTextActive: {
    color: colors.text
  },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 4
  },
  groupTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2
  },
  groupHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2
  },
  groupList: {
    gap: 10
  },
  routeCard: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10
  },
  routeHeader: {
    gap: 3
  },
  routeTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600"
  },
  routeHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  routeButton: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2
  },
  routeButtonDisabled: {
    opacity: 0.4
  },
  routeButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600"
  }
});
