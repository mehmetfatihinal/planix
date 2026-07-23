import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AppHeader } from "@/components/app-header";
import { SheetModal } from "@/components/sheet-modal";
import { EmptyState, GhostButton, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { TaskCard } from "@/components/task-card";
import { useAppData } from "@/lib/app-data-context";
import { companyById, isUndatedTask, sortByDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { canRouteToCompany, openCompanyRoute } from "@/lib/location";
import { useUserLocation } from "@/lib/location-context";
import type { Task } from "@/types/business";

type FilterKey = "all" | "pending" | "overdue" | "rejected" | "undated" | "done";

function isOverdueOpen(task: Task): boolean {
  if (task.status !== "open") return false;
  if (!task.dueDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.dueDate < today;
}

function isRejected(task: Task): boolean {
  // A task is "rejected" while it carries a rejection marker and hasn't been
  // resubmitted (pending_approval) or completed (done). "overdue" is the
  // effective status when dueDate is past, so include it.
  if (!task.lastRejectedAt) return false;
  return task.status === "open" || task.status === "overdue" || task.status === "snoozed";
}

export default function AllTasksScreen() {
  const { data, acknowledgeTask, addTaskNote, cancelTask, createTask, markTaskDone, snoozeTask, updateTask, refresh, refreshing } = useAppData();
  const { t } = useI18n();
  const { state: locationState } = useUserLocation();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [undated, setUndated] = useState(true);
  const [saving, setSaving] = useState(false);

  async function submitTask() {
    if (saving || !newTitle.trim()) return;
    setSaving(true);
    try {
      // Zamansız görev seçiliyse ya da tarih boş bırakıldıysa → dueDate null.
      // Böylece görev bugüne çevrilmez ve hatırlatma kurulmaz (zamansız görev).
      const asUndated = undated || !newDate.trim();
      await createTask({
        title: newTitle.trim(),
        type: "todo",
        moduleIds: ["module-todo"],
        dueDate: asUndated ? null : newDate.trim(),
        dueTime: asUndated ? null : newTime.trim() || null,
        notificationsEnabled: !asUndated
      });
      setNewTitle("");
      setNewDate("");
      setNewTime("");
      setUndated(true);
      setComposerOpen(false);
    } finally {
      setSaving(false);
    }
  }

  // Alışkanlıklar (isHabit) normal görev listelerine ve "Zamansız Görevler" bölümüne
  // girmez — onlar yalnızca Alışkanlıklar ekranında görünür.
  const visibleTasks = useMemo(() => data.tasks.filter((item) => !item.isHabit), [data.tasks]);

  const counts = useMemo(() => {
    const all = visibleTasks.length;
    const pending = visibleTasks.filter((item) => item.status === "pending_approval").length;
    const overdue = visibleTasks.filter((item) => item.status === "overdue" || isOverdueOpen(item)).length;
    const rejected = visibleTasks.filter(isRejected).length;
    const undatedCount = visibleTasks.filter(isUndatedTask).length;
    const done = visibleTasks.filter((item) => item.status === "done").length;
    return { all, pending, overdue, rejected, undated: undatedCount, done };
  }, [visibleTasks]);

  const filteredTasks = useMemo(() => {
    let list: Task[];
    switch (filter) {
      case "pending":
        list = visibleTasks.filter((item) => item.status === "pending_approval");
        break;
      case "overdue":
        list = visibleTasks.filter((item) => item.status === "overdue" || isOverdueOpen(item));
        break;
      case "rejected":
        list = visibleTasks.filter(isRejected);
        break;
      case "undated":
        list = visibleTasks.filter(isUndatedTask);
        break;
      case "done":
        list = visibleTasks.filter((item) => item.status === "done");
        break;
      default:
        list = visibleTasks;
    }
    return sortByDateTime(list);
  }, [visibleTasks, filter]);

  const tabs: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "all", label: "Tümü", count: counts.all },
    { key: "pending", label: "Onay bekleyen", count: counts.pending },
    { key: "overdue", label: "Geciken", count: counts.overdue },
    { key: "rejected", label: "Reddedilen", count: counts.rejected },
    { key: "undated", label: t("tasks.undated.tab"), count: counts.undated },
    { key: "done", label: "Tamamlanan", count: counts.done }
  ];

  return (
    <Screen withTabs onRefresh={refresh} refreshing={refreshing}>
      <AppHeader title="Görevler" subtitle="Tüm görevleri durum bazında filtrele." />

      <PrimaryButton label={t("tasks.add")} onPress={() => setComposerOpen(true)} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRow}
        style={styles.tabScroller}
      >
        {tabs.map((tab) => {
          const active = filter === tab.key;
          const hasCount = tab.count > 0;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setFilter(tab.key)}
              style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && !active && { opacity: 0.7 }]}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
              {hasCount ? (
                <View style={[styles.tabBadge, active && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, active && styles.tabBadgeTextActive]}>{tab.count}</Text>
                </View>
              ) : null}
              {active ? <View style={styles.tabUnderline} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {filter === "undated" ? (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("tasks.undated.section")}</Text>
          <Text style={styles.sectionHint}>{t("tasks.undated.hint")}</Text>
        </View>
      ) : null}

      {filteredTasks.length === 0 ? (
        filter === "undated" ? (
          <EmptyState title={t("tasks.undated.empty.title")} description={t("tasks.undated.empty.desc")} />
        ) : (
          <EmptyState title="Bu filtreye uygun görev yok" description="Diğer filtreleri deneyebilirsin." />
        )
      ) : (
        filteredTasks.map((task) => {
          const company = task.companyId ? companyById(data.companies, task.companyId) : null;
          return (
            <TaskCard
              key={task.id}
              task={{ ...task, moduleIds: task.moduleIds.map((moduleId) => data.modules.find((item) => item.id === moduleId)?.name ?? moduleId) }}
              company={company}
              onDone={(note) => markTaskDone(task, note)}
              onSnooze={(hours, reason) => snoozeTask(task, hours, reason)}
              onAcknowledge={() => acknowledgeTask(task.id)}
              onCancel={() => cancelTask(task.id)}
              onAddNote={(content) => addTaskNote(task, content)}
              onReschedule={(date, time) => updateTask({ ...task, dueDate: date, dueTime: time, status: "open", notificationsEnabled: true })}
              onOpenRoute={
                company && canRouteToCompany(company)
                  ? () => openCompanyRoute(company, locationState.coords)
                  : undefined
              }
            />
          );
        })
      )}

      <SheetModal
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        title={t("tasks.compose.title")}
        subtitle={t("tasks.compose.subtitle")}
        footer={
          <>
            <PrimaryButton
              label={saving ? "Kaydediliyor..." : "Kaydet"}
              onPress={() => void submitTask()}
              loading={saving}
              disabled={!newTitle.trim()}
            />
            <GhostButton label="Vazgeç" onPress={() => setComposerOpen(false)} />
          </>
        }
      >
        <TextField
          label={t("tasks.field.title")}
          value={newTitle}
          onChangeText={setNewTitle}
          placeholder={t("tasks.field.titlePlaceholder")}
        />

        <Pressable style={styles.toggleRow} onPress={() => setUndated((value) => !value)}>
          <Feather name={undated ? "check-square" : "square"} size={18} color={undated ? colors.primary : colors.muted} />
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleLabel}>{t("tasks.undated.toggle")}</Text>
            <Text style={styles.toggleHint}>{t("tasks.undated.toggleHint")}</Text>
          </View>
        </Pressable>

        {undated ? null : (
          <>
            <TextField
              label={t("tasks.field.date")}
              value={newDate}
              onChangeText={setNewDate}
              placeholder="2026-07-20"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />
            <TextField
              label={t("tasks.field.time")}
              value={newTime}
              onChangeText={setNewTime}
              placeholder="14:30"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />
          </>
        )}
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    gap: 3
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2
  },
  sectionHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 4
  },
  toggleCopy: {
    flex: 1,
    gap: 2
  },
  toggleLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500"
  },
  toggleHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16
  },
  tabScroller: {
    marginHorizontal: -16,
    flexGrow: 0
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 16,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    position: "relative"
  },
  tabActive: {},
  tabLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: -0.1
  },
  tabLabelActive: {
    color: colors.text,
    fontWeight: "600"
  },
  tabBadge: {
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center"
  },
  tabBadgeActive: {
    backgroundColor: colors.primary
  },
  tabBadgeText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.2
  },
  tabBadgeTextActive: {
    color: "#fff"
  },
  tabUnderline: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: -7,
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: 1
  }
});
