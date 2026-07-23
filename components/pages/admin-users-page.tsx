"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Shield, ShieldOff } from "lucide-react";
import { apiRequest, type AdminUserSummary } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-state";
import { useAppState } from "@/lib/app-state";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/ui-kit";

export function AdminUsersPage() {
  const { token, user: currentUser, refresh } = useAuth();
  const { t, promoteUser, demoteUser } = useAppState();
  const searchParams = useSearchParams();
  const roleFilter = searchParams.get("role");
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const visibleUsers = useMemo(
    () => (roleFilter === "admin" ? users.filter((user) => user.isAdmin) : users),
    [roleFilter, users]
  );

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiRequest<AdminUserSummary[]>("/admin/users", {}, token);
      setUsers(data);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function toggleAdmin(target: AdminUserSummary) {
    setErrorMsg(null);
    setBusyIds((current) => [...current, target.id]);
    try {
      if (target.isAdmin) {
        await demoteUser(target.id);
      } else {
        await promoteUser(target.id);
      }
      if (currentUser?.id === target.id) {
        await refresh();
      }
      await load();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : t("admin.users.actionFailed"));
    } finally {
      setBusyIds((current) => current.filter((id) => id !== target.id));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("admin.users.title")} subtitle={t("admin.users.subtitle")} />
      {errorMsg ? (
        <Card><p className="text-sm text-danger">{errorMsg}</p></Card>
      ) : null}
      {loading ? (
        <Card><p className="text-sm text-muted dark:text-darkMuted">{t("admin.loading")}</p></Card>
      ) : visibleUsers.length === 0 ? (
        <EmptyState title={t("admin.users.empty")} />
      ) : (
        <Card>
          {roleFilter === "admin" ? (
            <p className="mb-3 text-sm text-muted dark:text-darkMuted">
              {t("admin.users.adminBadge")} · {visibleUsers.length}
            </p>
          ) : null}
          <div className="divide-y divide-[#E8DECF] dark:divide-darkBorder">
            {visibleUsers.map((user) => {
              const busy = busyIds.includes(user.id);
              return (
                <div key={user.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-text dark:text-[#F5F0EA]">{user.name}</span>
                      {user.isAdmin ? <Badge tone="success">{t("admin.users.adminBadge")}</Badge> : null}
                      {user.isSystemAdmin ? <Badge tone="warning">{t("admin.users.systemAdminBadge")}</Badge> : null}
                    </div>
                    <p className="text-sm text-muted dark:text-darkMuted">{user.email}</p>
                    <p className="mt-1 text-xs text-muted/80 dark:text-darkMuted/80">
                      {t("admin.users.taskSummary", {
                        open: user.taskCounts.open,
                        pending: user.taskCounts.pending,
                        done: user.taskCounts.done
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/users/${user.id}`}>
                      <Button variant="ghost">
                        <ChevronRight size={16} />
                        {t("admin.users.details")}
                      </Button>
                    </Link>
                    {user.isSystemAdmin ? null : (
                      <Button
                        variant={user.isAdmin ? "ghost" : "secondary"}
                        onClick={() => void toggleAdmin(user)}
                        disabled={busy}
                      >
                        {user.isAdmin ? <ShieldOff size={16} /> : <Shield size={16} />}
                        {user.isAdmin ? t("admin.users.demote") : t("admin.users.promote")}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
