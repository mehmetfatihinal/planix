"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Check,
  Clock3,
  Mail,
  Shield,
  ShieldCheck,
  ShieldOff,
  ChevronLeft
} from "lucide-react";
import { apiRequest, type AdminCompanySummary, type AdminUserSummary } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-state";
import { useAppState } from "@/lib/app-state";
import { Badge, Button, Card, EmptyState, PageHeader, SectionTitle, StatCard } from "@/components/ui/ui-kit";
import type { Task } from "@/types/business";

interface UserTaskGroups {
  open: Task[];
  pending: Task[];
  done: Task[];
  snoozed: Task[];
  overdue: Task[];
}

const EMPTY_GROUPS: UserTaskGroups = { open: [], pending: [], done: [], snoozed: [], overdue: [] };

function groupTasks(tasks: Task[]): UserTaskGroups {
  const todayIso = new Date().toISOString().slice(0, 10);
  return tasks.reduce<UserTaskGroups>((acc, task) => {
    if (task.status === "done") {
      acc.done.push(task);
    } else if (task.status === "pending_approval") {
      acc.pending.push(task);
    } else if (task.status === "snoozed") {
      acc.snoozed.push(task);
    } else if (task.status === "open") {
      const isOverdue = Boolean(task.dueDate && task.dueDate < todayIso);
      if (isOverdue) acc.overdue.push(task);
      else acc.open.push(task);
    }
    return acc;
  }, { open: [], pending: [], done: [], snoozed: [], overdue: [] });
}

export function AdminUserDetailPage({ userId }: { userId: string }) {
  const { token, user: currentUser, refresh } = useAuth();
  const { t, data: ownData, promoteUser, demoteUser, approveTask, rejectTask } = useAppState();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [companies, setCompanies] = useState<AdminCompanySummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [userList, companyList, taskList] = await Promise.all([
        apiRequest<AdminUserSummary[]>("/admin/users", {}, token),
        apiRequest<AdminCompanySummary[]>("/admin/companies", {}, token),
        apiRequest<Task[]>(`/admin/users/${userId}/tasks`, {}, token)
      ]);
      setUsers(userList);
      setCompanies(companyList);
      setTasks(taskList);
    } finally {
      setLoading(false);
    }
  }, [token, userId]);

  useEffect(() => { void load(); }, [load]);

  const user = useMemo(() => users.find((item) => item.id === userId) ?? null, [userId, users]);
  const userCompanies = useMemo(() => companies.filter((item) => item.userId === userId), [companies, userId]);
  const groups = useMemo(() => groupTasks(tasks), [tasks]);
  const companyById = useMemo(() => {
    const map = new Map<string, AdminCompanySummary>();
    userCompanies.forEach((c) => map.set(c.id, c));
    return map;
  }, [userCompanies]);

  async function handleToggleAdmin() {
    if (!user || user.isSystemAdmin) return;
    setError(null);
    setBusy(true);
    try {
      if (user.isAdmin) await demoteUser(user.id);
      else await promoteUser(user.id);
      if (currentUser?.id === user.id) await refresh();
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("admin.users.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove(task: Task) {
    setBusy(true);
    try {
      await approveTask(userId, task.id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(task: Task) {
    setBusy(true);
    try {
      await rejectTask(userId, task.id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-muted hover:text-primary dark:text-darkMuted">
          <ChevronLeft size={16} />
          {t("admin.userDetail.back")}
        </Link>
        <Card><p className="text-sm text-muted dark:text-darkMuted">{t("admin.loading")}</p></Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-muted hover:text-primary dark:text-darkMuted">
          <ChevronLeft size={16} />
          {t("admin.userDetail.back")}
        </Link>
        <EmptyState title={t("admin.userDetail.notFound")} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-muted hover:text-primary dark:text-darkMuted">
        <ChevronLeft size={16} />
        {t("admin.userDetail.back")}
      </Link>

      <PageHeader
        title={user.name}
        subtitle={user.email}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {user.isAdmin ? <Badge tone="success">{t("admin.users.adminBadge")}</Badge> : null}
            {user.isSystemAdmin ? <Badge tone="warning">{t("admin.users.systemAdminBadge")}</Badge> : null}
            {!user.isSystemAdmin ? (
              <Button
                variant={user.isAdmin ? "ghost" : "secondary"}
                onClick={() => void handleToggleAdmin()}
                disabled={busy}
              >
                {user.isAdmin ? <ShieldOff size={16} /> : <Shield size={16} />}
                {user.isAdmin ? t("admin.users.demote") : t("admin.users.promote")}
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? <Card><p className="text-sm text-danger">{error}</p></Card> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <a href="#section-open" className="block transition hover:-translate-y-0.5">
          <StatCard label={t("admin.userDetail.openTasks")} value={groups.open.length} icon={Clock3} />
        </a>
        <a href="#section-overdue" className="block transition hover:-translate-y-0.5">
          <StatCard label={t("admin.userDetail.overdueTasks")} value={groups.overdue.length} icon={AlertTriangle} tone="danger" />
        </a>
        <a href="#section-pending" className="block transition hover:-translate-y-0.5">
          <StatCard label={t("admin.userDetail.pendingTasks")} value={groups.pending.length} icon={Shield} tone="warning" />
        </a>
        <a href="#section-done" className="block transition hover:-translate-y-0.5">
          <StatCard label={t("admin.userDetail.doneTasks")} value={groups.done.length} icon={ShieldCheck} tone="success" />
        </a>
        <a href="#section-companies" className="block transition hover:-translate-y-0.5">
          <StatCard label={t("admin.userDetail.companies")} value={userCompanies.length} icon={Building2} />
        </a>
      </div>

      <div id="section-pending" className="scroll-mt-24" />
      {groups.pending.length > 0 ? (
        <Card>
          <SectionTitle title={t("admin.userDetail.pendingHeading")} icon={Shield} />
          <div className="mt-3 space-y-3">
            {groups.pending.map((task) => (
              <div key={task.id} className="flex flex-col gap-3 rounded-2xl border border-amber-300/40 bg-amber-50 p-3 dark:border-amber-400/40 dark:bg-[#2a2419] lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-text dark:text-[#F5F0EA]">{task.title}</p>
                  <p className="mt-0.5 text-sm text-muted dark:text-darkMuted">
                    {(task.companyId && companyById.get(task.companyId)?.name) ?? t("admin.userDetail.personal")}
                    {task.completionRequestedNote ? ` · ${task.completionRequestedNote}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void handleApprove(task)} disabled={busy}>
                    <Check size={16} />
                    {t("admin.approvals.approve")}
                  </Button>
                  <Button variant="danger" onClick={() => void handleReject(task)} disabled={busy}>
                    {t("admin.approvals.reject")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div id="section-open" className="scroll-mt-24" />
      <TaskGroup
        heading={t("admin.userDetail.openHeading")}
        icon={Clock3}
        tasks={groups.open}
        companyById={companyById}
        emptyLabel={t("admin.userDetail.openEmpty")}
        personalLabel={t("admin.userDetail.personal")}
      />
      <div id="section-overdue" className="scroll-mt-24" />
      <TaskGroup
        heading={t("admin.userDetail.overdueHeading")}
        icon={AlertTriangle}
        tasks={groups.overdue}
        companyById={companyById}
        emptyLabel={t("admin.userDetail.overdueEmpty")}
        personalLabel={t("admin.userDetail.personal")}
        tone="danger"
      />
      <div id="section-done" className="scroll-mt-24" />
      <TaskGroup
        heading={t("admin.userDetail.doneHeading")}
        icon={ShieldCheck}
        tasks={groups.done.slice(0, 30)}
        companyById={companyById}
        emptyLabel={t("admin.userDetail.doneEmpty")}
        personalLabel={t("admin.userDetail.personal")}
        showCompletedAt
      />

      <div id="section-companies" className="scroll-mt-24" />
      <Card>
        <SectionTitle title={t("admin.userDetail.companiesHeading")} icon={Building2} />
        {userCompanies.length === 0 ? (
          <EmptyState title={t("admin.userDetail.companiesEmpty")} />
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {userCompanies.map((company) => {
              const taskCount = tasks.filter((task) => task.companyId === company.id).length;
              return (
                <Link
                  key={company.id}
                  href={`/companies/${company.id}`}
                  className="rounded-2xl border border-[#E8DECF] bg-white p-3 transition hover:border-primary/30 dark:border-darkBorder dark:bg-[#202020]"
                >
                  <p className="font-medium text-text dark:text-[#F5F0EA]">{company.name}</p>
                  <p className="mt-0.5 text-sm text-muted dark:text-darkMuted">{company.address || "—"}</p>
                  <p className="mt-1 text-xs text-muted/80 dark:text-darkMuted/80">{taskCount} {t("admin.userDetail.tasksWord")}</p>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function TaskGroup({
  heading,
  icon,
  tasks,
  companyById,
  emptyLabel,
  personalLabel,
  showCompletedAt = false,
  tone
}: {
  heading: string;
  icon: typeof Clock3;
  tasks: Task[];
  companyById: Map<string, AdminCompanySummary>;
  emptyLabel: string;
  personalLabel: string;
  showCompletedAt?: boolean;
  tone?: "danger";
}) {
  return (
    <Card>
      <SectionTitle title={heading} icon={icon} />
      {tasks.length === 0 ? (
        <p className="mt-3 text-sm text-muted dark:text-darkMuted">{emptyLabel}</p>
      ) : (
        <div className="mt-3 divide-y divide-[#E8DECF] dark:divide-darkBorder">
          {tasks.map((task) => {
            const company = task.companyId ? companyById.get(task.companyId) : null;
            return (
              <div key={task.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text dark:text-[#F5F0EA]">{task.title}</span>
                    <Badge tone={tone === "danger" ? "danger" : "neutral"}>{task.priority}</Badge>
                    <span className="inline-flex items-center gap-1 text-xs text-muted dark:text-darkMuted">
                      <Building2 size={12} />
                      {company?.name ?? personalLabel}
                    </span>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-muted dark:text-darkMuted">
                  <CalendarClock size={12} />
                  {showCompletedAt ? (task.completedAt ?? task.dueDate ?? "—") : `${task.dueDate ?? "—"} ${task.dueTime ?? ""}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
