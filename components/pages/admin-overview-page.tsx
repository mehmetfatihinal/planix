"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, ShieldCheck, Users, ClipboardList } from "lucide-react";
import { apiRequest, type AdminUserSummary } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-state";
import { useAppState } from "@/lib/app-state";
import { Card, PageHeader, StatCard } from "@/components/ui/ui-kit";

export function AdminOverviewPage() {
  const { token } = useAuth();
  const { t } = useAppState();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    apiRequest<AdminUserSummary[]>("/admin/users", {}, token)
      .then(setUsers)
      .finally(() => setLoading(false));
  }, [token]);

  const totals = users.reduce(
    (acc, user) => {
      acc.users += 1;
      acc.admins += user.isAdmin ? 1 : 0;
      acc.open += user.taskCounts.open;
      acc.pending += user.taskCounts.pending;
      acc.done += user.taskCounts.done;
      return acc;
    },
    { users: 0, admins: 0, open: 0, pending: 0, done: 0 }
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.overview.title")} subtitle={t("admin.overview.subtitle")} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Link href="/admin/users" className="block transition hover:-translate-y-0.5">
          <StatCard label={t("admin.stats.users")} value={totals.users} icon={Users} />
        </Link>
        <Link href="/admin/users?role=admin" className="block transition hover:-translate-y-0.5">
          <StatCard label={t("admin.stats.admins")} value={totals.admins} icon={ShieldCheck} tone="success" />
        </Link>
        <Link href="/admin/tasks?status=open" className="block transition hover:-translate-y-0.5">
          <StatCard label={t("admin.stats.openTasks")} value={totals.open} icon={ClipboardList} />
        </Link>
        <Link href="/admin/approvals" className="block transition hover:-translate-y-0.5">
          <StatCard label={t("admin.stats.pendingTasks")} value={totals.pending} icon={Shield} tone="warning" />
        </Link>
        <Link href="/admin/tasks?status=done" className="block transition hover:-translate-y-0.5">
          <StatCard label={t("admin.stats.doneTasks")} value={totals.done} icon={ShieldCheck} tone="success" />
        </Link>
      </div>
      <Card>
        <h3 className="text-base font-semibold text-text dark:text-[#F5F0EA]">{t("admin.overview.quickLinks")}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/admin/approvals" className="rounded-2xl border border-[#E8DECF] bg-white p-4 transition hover:border-primary/30 dark:border-darkBorder dark:bg-[#202020]">
            <div className="flex items-center gap-2 font-medium text-text dark:text-[#F5F0EA]">
              <Shield size={18} className="text-primary" />
              {t("admin.nav.approvals")}
            </div>
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">{totals.pending} {t("admin.stats.pendingTasksHint")}</p>
          </Link>
          <Link href="/admin/users" className="rounded-2xl border border-[#E8DECF] bg-white p-4 transition hover:border-primary/30 dark:border-darkBorder dark:bg-[#202020]">
            <div className="flex items-center gap-2 font-medium text-text dark:text-[#F5F0EA]">
              <Users size={18} className="text-primary" />
              {t("admin.nav.users")}
            </div>
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">{totals.users} {t("admin.stats.usersHint")}</p>
          </Link>
          <Link href="/admin/tasks" className="rounded-2xl border border-[#E8DECF] bg-white p-4 transition hover:border-primary/30 dark:border-darkBorder dark:bg-[#202020]">
            <div className="flex items-center gap-2 font-medium text-text dark:text-[#F5F0EA]">
              <ClipboardList size={18} className="text-primary" />
              {t("admin.nav.tasks")}
            </div>
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">{t("admin.overview.allTasksHint")}</p>
          </Link>
        </div>
      </Card>
      {loading ? <p className="text-sm text-muted dark:text-darkMuted">{t("admin.loading")}</p> : null}
    </div>
  );
}
