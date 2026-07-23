import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { AppHeader } from "@/components/app-header";
import { Card, Chip, EmptyState, GhostButton, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { useAppData } from "@/lib/app-data-context";
import { formatDateLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Task } from "@/types/business";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function HabitsScreen() {
  const { habit: focusedHabitId } = useLocalSearchParams<{ habit?: string }>();
  const { habits, habitStart, habitSnooze, habitStop, refresh, refreshing } = useAppData();
  const { t } = useI18n();

  return (
    <Screen withTabs onRefresh={refresh} refreshing={refreshing}>
      <AppHeader title={t("habits.title")} subtitle={t("habits.subtitle")} />

      {habits.length === 0 ? (
        <EmptyState title={t("habits.empty.title")} description={t("habits.empty.desc")} />
      ) : (
        habits.map((habit) =>
          habit.habitStage === "active" ? (
            <HabitActiveCard
              key={habit.id}
              habit={habit}
              highlighted={habit.id === focusedHabitId}
              onStop={() => habitStop(habit.id)}
            />
          ) : (
            <HabitPlanningCard
              key={habit.id}
              habit={habit}
              highlighted={habit.id === focusedHabitId}
              onStart={(payload) => habitStart(habit.id, payload)}
              onSnooze={() => habitSnooze(habit.id, 3)}
              onStop={() => habitStop(habit.id)}
            />
          )
        )
      )}
    </Screen>
  );
}

function HabitPlanningCard({
  habit,
  highlighted,
  onStart,
  onSnooze,
  onStop
}: {
  habit: Task;
  highlighted: boolean;
  onStart: (payload: { startDate: string; reminderTime?: string; intervalDays?: number }) => Promise<void>;
  onSnooze: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [startDate, setStartDate] = useState("");
  const [reminderTime, setReminderTime] = useState("20:00");
  const [busy, setBusy] = useState(false);

  const canStart = DATE_PATTERN.test(startDate.trim());

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={highlighted ? styles.highlighted : undefined}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>«{habit.title}»</Text>
        <Chip label={t("habits.planning.badge")} tone="warning" />
      </View>
      <Text style={styles.question}>{t("habits.planning.question")}</Text>

      <TextField
        label={t("habits.field.startDate")}
        value={startDate}
        onChangeText={setStartDate}
        placeholder="2026-07-20"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
      />
      <TextField
        label={t("habits.field.reminderTime")}
        value={reminderTime}
        onChangeText={setReminderTime}
        placeholder="20:00"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
      />

      <PrimaryButton
        label={t("habits.action.start")}
        onPress={() => void run(() => onStart({ startDate: startDate.trim(), reminderTime: reminderTime.trim() || undefined }))}
        loading={busy}
        disabled={!canStart}
      />
      <PrimaryButton label={t("habits.action.snooze")} variant="secondary" onPress={() => void run(onSnooze)} />
      <GhostButton label={t("habits.action.cancel")} onPress={() => void run(onStop)} />
    </Card>
  );
}

function HabitActiveCard({
  habit,
  highlighted,
  onStop
}: {
  habit: Task;
  highlighted: boolean;
  onStop: () => Promise<void>;
}) {
  const { t, language } = useI18n();
  const [busy, setBusy] = useState(false);

  return (
    <Card style={highlighted ? styles.highlighted : undefined}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{habit.title}</Text>
        <Chip label={t("habits.active.badge")} tone="success" />
      </View>

      <View style={styles.metaRow}>
        <Feather name="calendar" size={14} color={colors.muted} />
        <Text style={styles.metaText}>
          {t("habits.active.startLabel")}: {formatDateLabel(habit.habitStartDate ?? null, language)}
        </Text>
      </View>
      <View style={styles.metaRow}>
        <Feather name="bell" size={14} color={colors.muted} />
        <Text style={styles.metaText}>
          {t("habits.active.dailyReminder")}: {habit.habitReminderTime || "20:00"}
        </Text>
      </View>

      <GhostButton
        label={t("habits.active.stop")}
        onPress={() => {
          if (busy) return;
          setBusy(true);
          void onStop().finally(() => setBusy(false));
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  highlighted: {
    borderColor: colors.primary
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    flex: 1
  },
  question: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  metaText: {
    color: colors.textSoft,
    fontSize: 13
  }
});
