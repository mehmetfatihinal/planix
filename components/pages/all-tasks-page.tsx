"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, CalendarOff, Clock, Target } from "lucide-react";
import { getHabits, getUndatedTasks, useAppState } from "@/lib/app-state";
import { formatDate, isoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, PageHeader, SectionTitle, TaskCard } from "@/components/ui/ui-kit";
import type { Task } from "@/types/business";

type FilterKey = "all" | "pending" | "overdue" | "rejected" | "done";

function isOverdueOpen(task: Task): boolean {
  if (task.status !== "open") return false;
  if (!task.dueDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.dueDate < today;
}

function isRejected(task: Task): boolean {
  // A task is "rejected" if it carries a rejection marker AND has not been
  // resubmitted or completed yet. status "done" or "pending_approval" overrides
  // the marker. status "open" and "overdue" (the effective status when due is
  // past) both count as still-rejected.
  if (!task.lastRejectedAt) return false;
  return task.status === "open" || task.status === "overdue" || task.status === "snoozed";
}

export function AllTasksPage() {
  const { data, t } = useAppState();
  const [filter, setFilter] = useState<FilterKey>("all");
  const searchParams = useSearchParams();
  const highlightHabitId = searchParams.get("habit");

  // Habits belong solely in the "Alışkanlıklar" section; keep them out of the
  // regular status lists and counts.
  const regularTasks = useMemo(() => data.tasks.filter((task) => !task.isHabit), [data.tasks]);

  const counts = useMemo(() => {
    const pending = regularTasks.filter((task) => task.status === "pending_approval").length;
    const overdue = regularTasks.filter((task) => task.status === "overdue" || isOverdueOpen(task)).length;
    const rejected = regularTasks.filter(isRejected).length;
    const done = regularTasks.filter((task) => task.status === "done").length;
    return { all: regularTasks.length, pending, overdue, rejected, done };
  }, [regularTasks]);

  const visibleTasks = useMemo(() => {
    switch (filter) {
      case "pending":
        return regularTasks.filter((task) => task.status === "pending_approval");
      case "overdue":
        return regularTasks.filter((task) => task.status === "overdue" || isOverdueOpen(task));
      case "rejected":
        return regularTasks.filter(isRejected);
      case "done":
        return regularTasks.filter((task) => task.status === "done");
      default:
        return regularTasks;
    }
  }, [regularTasks, filter]);

  const undatedTasks = useMemo(() => getUndatedTasks(data), [data]);

  const tabs: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "all", label: t("tasksPage.all"), count: counts.all },
    { key: "pending", label: t("tasksPage.pending"), count: counts.pending },
    { key: "overdue", label: t("tasksPage.overdue"), count: counts.overdue },
    { key: "rejected", label: t("tasksPage.rejected"), count: counts.rejected },
    { key: "done", label: t("tasksPage.done"), count: counts.done }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("tasksPage.title")} subtitle={t("tasksPage.subtitle")} />

      <Card>
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition " +
                  (active
                    ? "border-primary bg-primary text-white shadow-sm dark:border-darkPrimary dark:bg-darkPrimary"
                    : "border-[#E5D8C7] bg-white text-muted hover:border-primary/30 hover:text-primary dark:border-darkBorder dark:bg-[#242424] dark:text-darkMuted")
                }
              >
                <span>{tab.label}</span>
                <span
                  className={
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold " +
                    (active ? "bg-white/20 text-white" : "bg-beige text-text dark:bg-[#1B1B1B] dark:text-[#F5F0EA]")
                  }
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {visibleTasks.length === 0 ? (
        <EmptyState title={t("tasksPage.empty")} />
      ) : (
        <div className="space-y-3">
          {visibleTasks.map((task) => (
            <TaskCard key={task.id} task={task} showRouteAction />
          ))}
        </div>
      )}

      <HabitsSection highlightHabitId={highlightHabitId} />

      <Card>
        <SectionTitle title={t("tasks.undatedTitle")} subtitle={t("tasks.undatedSubtitle")} icon={CalendarOff} />
        {undatedTasks.length === 0 ? (
          <EmptyState title={t("tasks.undatedEmpty")} />
        ) : (
          <div className="space-y-3">
            {undatedTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function HabitsSection({ highlightHabitId }: { highlightHabitId: string | null }) {
  const { data, t } = useAppState();
  const habits = useMemo(() => getHabits(data), [data]);
  const planningHabits = habits.filter((habit) => habit.habitStage !== "active");
  const activeHabits = habits.filter((habit) => habit.habitStage === "active");

  return (
    <Card>
      <SectionTitle title={t("habits.title")} subtitle={t("habits.subtitle")} icon={Target} />
      {habits.length === 0 ? (
        <EmptyState title={t("habits.empty")} />
      ) : (
        <div className="space-y-3">
          {planningHabits.map((habit) => (
            <HabitPlanningCard key={habit.id} habit={habit} highlighted={habit.id === highlightHabitId} />
          ))}
          {activeHabits.map((habit) => (
            <HabitActiveCard key={habit.id} habit={habit} highlighted={habit.id === highlightHabitId} />
          ))}
        </div>
      )}
    </Card>
  );
}

function useHabitHighlight(highlighted: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);
  return ref;
}

const habitCardClass = (highlighted: boolean) =>
  cn(
    "rounded-2xl border p-4 transition dark:bg-[#202020]",
    highlighted
      ? "border-primary bg-primary/5 ring-2 ring-primary/40 dark:border-darkPrimary dark:ring-darkPrimary/40"
      : "border-[#E8DECF] bg-white dark:border-darkBorder"
  );

function HabitPlanningCard({ habit, highlighted }: { habit: Task; highlighted: boolean }) {
  const { t, habitStart, habitSnooze, habitStop } = useAppState();
  const [startDate, setStartDate] = useState(isoDate(0));
  const [reminderTime, setReminderTime] = useState(habit.habitReminderTime || "20:00");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const ref = useHabitHighlight(highlighted);

  async function onStart() {
    if (!startDate || busy) return;
    setBusy(true);
    try {
      await habitStart(habit.id, { startDate, reminderTime: reminderTime || undefined });
    } finally {
      setBusy(false);
    }
  }

  async function onSnooze() {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      await habitSnooze(habit.id, { days: 3 });
      setFeedback(t("habits.snoozed"));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (busy) return;
    setBusy(true);
    try {
      await habitStop(habit.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} id={`habit-${habit.id}`} className={habitCardClass(highlighted)}>
      <Badge tone="warning">{t("habits.planningBadge")}</Badge>
      <h3 className="mt-2 text-base font-semibold text-text dark:text-[#F5F0EA]">
        {t("habits.planningPrompt", { title: habit.title })}
      </h3>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm font-medium text-text dark:text-[#F5F0EA]">
          {t("habits.startDate")}
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
          />
        </label>
        <label className="block text-sm font-medium text-text dark:text-[#F5F0EA]">
          {t("habits.reminderTime")}
          <input
            type="time"
            value={reminderTime}
            onChange={(event) => setReminderTime(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => void onStart()} disabled={busy || !startDate}>
          <CalendarClock size={16} />
          {t("habits.start")}
        </Button>
        <Button variant="secondary" onClick={() => void onSnooze()} disabled={busy}>
          <Clock size={16} />
          {t("habits.snooze")}
        </Button>
        <Button variant="ghost" onClick={() => void onCancel()} disabled={busy}>
          {t("habits.cancel")}
        </Button>
      </div>
      {feedback ? <p className="mt-3 text-sm text-success dark:text-[#80D9B0]">{feedback}</p> : null}
    </div>
  );
}

function HabitActiveCard({ habit, highlighted }: { habit: Task; highlighted: boolean }) {
  const { t, language, habitStop } = useAppState();
  const [busy, setBusy] = useState(false);
  const ref = useHabitHighlight(highlighted);

  async function onStop() {
    if (busy) return;
    setBusy(true);
    try {
      await habitStop(habit.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} id={`habit-${habit.id}`} className={habitCardClass(highlighted)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">{t("habits.activeBadge")}</Badge>
            {habit.habitReminderTime ? (
              <Badge tone="primary">{t("habits.dailyReminder", { time: habit.habitReminderTime })}</Badge>
            ) : null}
          </div>
          <h3 className="mt-2 text-base font-semibold text-text dark:text-[#F5F0EA]">{habit.title}</h3>
          {habit.habitStartDate ? (
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">
              {t("habits.startedOn", { date: formatDate(habit.habitStartDate, language) })}
            </p>
          ) : null}
        </div>
        <Button variant="danger" onClick={() => void onStop()} disabled={busy}>
          {t("habits.stop")}
        </Button>
      </div>
    </div>
  );
}
