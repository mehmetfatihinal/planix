"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { UserPlus } from "lucide-react";
import {
  apiRequest,
  type AdminCompanySummary,
  type AdminTaskRow,
  type AdminUserSummary
} from "@/lib/api-client";
import { useAuth } from "@/lib/auth-state";
import { useAppState } from "@/lib/app-state";
import { isoDate } from "@/lib/format";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/ui-kit";
import type { TaskPriority } from "@/types/business";

const STATUS_FILTERS = ["", "open", "pending_approval", "done", "snoozed"] as const;

export function AdminTasksPage() {
  const { token } = useAuth();
  const { t, assignTask } = useAppState();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [companies, setCompanies] = useState<AdminCompanySummary[]>([]);
  const [userId, setUserId] = useState(searchParams.get("userId") ?? "");
  const [companyId, setCompanyId] = useState(searchParams.get("companyId") ?? "");
  const [status, setStatus] = useState<string>(searchParams.get("status") ?? "");
  const [rows, setRows] = useState<AdminTaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignCompanyId, setAssignCompanyId] = useState("");
  const [assignTitle, setAssignTitle] = useState("");
  const [assignDescription, setAssignDescription] = useState("");
  const [assignDueDate, setAssignDueDate] = useState(isoDate(0));
  const [assignDueTime, setAssignDueTime] = useState("");
  const [assignPriority, setAssignPriority] = useState<TaskPriority>("medium");
  const [assignRequirePhoto, setAssignRequirePhoto] = useState(true);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);

  // Static lookups
  useEffect(() => {
    if (!token) return;
    void apiRequest<AdminUserSummary[]>("/admin/users", {}, token).then(setUsers);
    void apiRequest<AdminCompanySummary[]>("/admin/companies", {}, token).then(setCompanies);
  }, [token]);

  const filteredCompanies = useMemo(() => {
    if (!userId) return companies;
    return companies.filter((company) => company.userId === userId);
  }, [companies, userId]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (userId) params.set("userId", userId);
    if (companyId) params.set("companyId", companyId);
    if (status) params.set("status", status);
    try {
      const data = await apiRequest<AdminTaskRow[]>(`/admin/tasks${params.toString() ? `?${params}` : ""}`, {}, token);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [companyId, status, token, userId]);

  useEffect(() => { void load(); }, [load]);

  const assignCompanies = useMemo(() => {
    if (!assignUserId) return companies;
    return companies.filter((company) => company.userId === assignUserId);
  }, [assignUserId, companies]);

  async function submitAssign(event: React.FormEvent) {
    event.preventDefault();
    if (!assignUserId || !assignTitle.trim() || assignBusy) return;
    setAssignBusy(true);
    setAssignError(null);
    try {
      await assignTask({
        targetUserId: assignUserId,
        title: assignTitle.trim(),
        description: assignDescription.trim() || null,
        companyId: assignCompanyId || null,
        dueDate: assignDueDate || null,
        dueTime: assignDueTime || null,
        priority: assignPriority,
        requirePhotoProof: assignRequirePhoto
      });
      setAssignSuccess(t("admin.assign.success"));
      setAssignOpen(false);
      setAssignTitle("");
      setAssignDescription("");
      setAssignDueTime("");
      setAssignRequirePhoto(true);
      await load();
    } catch (error) {
      setAssignError(error instanceof Error ? error.message : t("admin.users.actionFailed"));
    } finally {
      setAssignBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("admin.tasks.title")}
        subtitle={t("admin.tasks.subtitle")}
        action={
          <Button onClick={() => { setAssignOpen(true); setAssignError(null); setAssignSuccess(null); }}>
            <UserPlus size={16} />
            {t("admin.assign.title")}
          </Button>
        }
      />
      {assignSuccess ? (
        <Card><p className="text-sm text-success dark:text-[#80D9B0]">{assignSuccess}</p></Card>
      ) : null}
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium text-text dark:text-[#F5F0EA]">
            {t("admin.tasks.filterUser")}
            <select
              value={userId}
              onChange={(event) => { setUserId(event.target.value); setCompanyId(""); }}
              className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
            >
              <option value="">{t("admin.tasks.allUsers")}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-text dark:text-[#F5F0EA]">
            {t("admin.tasks.filterCompany")}
            <select
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
            >
              <option value="">{t("admin.tasks.allCompanies")}</option>
              {filteredCompanies.map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-text dark:text-[#F5F0EA]">
            {t("admin.tasks.filterStatus")}
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
            >
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value === "" ? t("admin.tasks.allStatuses") : t(`status.${value}` as never)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>
      {loading ? (
        <Card><p className="text-sm text-muted dark:text-darkMuted">{t("admin.loading")}</p></Card>
      ) : rows.length === 0 ? (
        <EmptyState title={t("admin.tasks.empty")} />
      ) : (
        <Card>
          <div className="divide-y divide-[#E8DECF] dark:divide-darkBorder">
            {rows.map((row) => (
              <div key={row.task.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text dark:text-[#F5F0EA]">{row.task.title}</span>
                  <Badge tone={
                    row.task.status === "done" ? "success"
                    : row.task.status === "pending_approval" ? "warning"
                    : row.task.status === "overdue" ? "danger"
                    : "neutral"
                  }>
                    {row.task.status}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted dark:text-darkMuted">
                  {row.user?.name ?? row.task.userId} · {row.company?.name ?? t("admin.tasks.personal")} ·{" "}
                  {row.task.dueDate ?? "-"} {row.task.dueTime ?? ""}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
      {assignOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={submitAssign}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#E8DECF] bg-[#FDFBF7] p-5 shadow-2xl dark:border-darkBorder dark:bg-[#1E1E1E]"
          >
            <h3 className="text-base font-semibold text-text dark:text-[#F5F0EA]">{t("admin.assign.title")}</h3>
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">{t("admin.assign.subtitle")}</p>
            {assignError ? (
              <div className="mt-3 rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger dark:text-[#FCA5A5]">
                {assignError}
              </div>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-text dark:text-[#F5F0EA] sm:col-span-2">
                {t("admin.assign.user")}
                <select
                  required
                  value={assignUserId}
                  onChange={(event) => { setAssignUserId(event.target.value); setAssignCompanyId(""); }}
                  className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                >
                  <option value="">-</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.name} ({user.email})</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-text dark:text-[#F5F0EA] sm:col-span-2">
                {t("quickTask.taskTitle")}
                <input
                  required
                  value={assignTitle}
                  onChange={(event) => setAssignTitle(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                />
              </label>
              <label className="block text-sm font-medium text-text dark:text-[#F5F0EA] sm:col-span-2">
                {t("quickTask.description")}
                <textarea
                  value={assignDescription}
                  onChange={(event) => setAssignDescription(event.target.value)}
                  className="mt-2 min-h-20 w-full rounded-xl border border-[#E5D8C7] bg-white p-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                />
              </label>
              <label className="block text-sm font-medium text-text dark:text-[#F5F0EA] sm:col-span-2">
                {t("admin.tasks.filterCompany")}
                <select
                  value={assignCompanyId}
                  onChange={(event) => setAssignCompanyId(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                >
                  <option value="">{t("quickTask.noCompany")}</option>
                  {assignCompanies.map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-text dark:text-[#F5F0EA]">
                {t("quickTask.dueDate")}
                <input
                  type="date"
                  value={assignDueDate}
                  onChange={(event) => setAssignDueDate(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                />
              </label>
              <label className="block text-sm font-medium text-text dark:text-[#F5F0EA]">
                {t("quickTask.dueTime")}
                <input
                  type="time"
                  value={assignDueTime}
                  onChange={(event) => setAssignDueTime(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                />
              </label>
              <label className="block text-sm font-medium text-text dark:text-[#F5F0EA]">
                {t("common.priority")}
                <select
                  value={assignPriority}
                  onChange={(event) => setAssignPriority(event.target.value as TaskPriority)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                >
                  <option value="low">{t("priority.low")}</option>
                  <option value="medium">{t("priority.medium")}</option>
                  <option value="high">{t("priority.high")}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 self-end text-sm font-medium text-text dark:text-[#F5F0EA]">
                <input
                  type="checkbox"
                  checked={assignRequirePhoto}
                  onChange={(event) => setAssignRequirePhoto(event.target.checked)}
                  className="h-4 w-4 accent-[#B03B4E]"
                />
                {t("admin.assign.requirePhoto")}
              </label>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAssignOpen(false)}>
                {t("actions.close")}
              </Button>
              <Button type="submit" disabled={assignBusy || !assignUserId || !assignTitle.trim()}>
                <UserPlus size={16} />
                {assignBusy ? t("approval.submitting") : t("admin.assign.submit")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
