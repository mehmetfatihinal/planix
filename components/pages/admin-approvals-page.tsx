"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { apiRequest, type AdminTaskRow } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-state";
import { useAppState } from "@/lib/app-state";
import { AuthImage, Button, Card, EmptyState, PageHeader } from "@/components/ui/ui-kit";

export function AdminApprovalsPage() {
  const { token } = useAuth();
  const { t, approveTask, rejectTask } = useAppState();
  const [rows, setRows] = useState<AdminTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [rejectModal, setRejectModal] = useState<AdminTaskRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiRequest<AdminTaskRow[]>("/admin/tasks/pending", {}, token);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleApprove(row: AdminTaskRow) {
    setBusyIds((current) => [...current, row.task.id]);
    try {
      await approveTask(row.task.userId, row.task.id);
      await load();
    } finally {
      setBusyIds((current) => current.filter((id) => id !== row.task.id));
    }
  }

  async function handleReject() {
    if (!rejectModal) return;
    const row = rejectModal;
    setBusyIds((current) => [...current, row.task.id]);
    try {
      await rejectTask(row.task.userId, row.task.id, rejectReason);
      setRejectModal(null);
      setRejectReason("");
      await load();
    } finally {
      setBusyIds((current) => current.filter((id) => id !== row.task.id));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("admin.approvals.title")} subtitle={t("admin.approvals.subtitle")} />
      {loading ? (
        <Card><p className="text-sm text-muted dark:text-darkMuted">{t("admin.loading")}</p></Card>
      ) : rows.length === 0 ? (
        <EmptyState title={t("admin.approvals.empty")} />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const busy = busyIds.includes(row.task.id);
            return (
              <Card key={row.task.id}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <h4 className="text-base font-semibold text-text dark:text-[#F5F0EA]">{row.task.title}</h4>
                    <p className="mt-1 text-sm text-muted dark:text-darkMuted">
                      {row.user?.name ?? row.task.userId} · {row.company?.name ?? t("admin.approvals.personal")}
                    </p>
                    {row.task.completionRequestedNote ? (
                      <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-[#2a2419] dark:text-amber-100">
                        <strong className="font-semibold">{t("admin.approvals.userNote")}:</strong>{" "}
                        {row.task.completionRequestedNote}
                      </div>
                    ) : null}
                    {row.completionPhotoUrl ? (
                      <div className="mt-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted dark:text-darkMuted">
                          {t("admin.approvals.photoProof")}
                        </p>
                        <div className="max-w-xs overflow-hidden rounded-xl border border-[#E8DECF] dark:border-darkBorder">
                          <AuthImage
                            src={row.completionPhotoUrl}
                            alt={t("admin.approvals.photoProof")}
                            className="h-44 w-full object-cover"
                          />
                        </div>
                      </div>
                    ) : null}
                    <p className="mt-2 text-xs text-muted/80 dark:text-darkMuted/80">
                      {t("admin.approvals.requestedAt")}: {row.task.completionRequestedAt ?? "-"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void handleApprove(row)} disabled={busy}>
                      <Check size={16} />
                      {t("admin.approvals.approve")}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => { setRejectModal(row); setRejectReason(""); }}
                      disabled={busy}
                    >
                      <X size={16} />
                      {t("admin.approvals.reject")}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {rejectModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#E8DECF] bg-white p-5 shadow-xl dark:border-darkBorder dark:bg-[#1f1f1f]">
            <h3 className="text-base font-semibold text-text dark:text-[#F5F0EA]">
              {t("admin.approvals.rejectTitle")}
            </h3>
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">{rejectModal.task.title}</p>
            <label className="mt-4 block text-sm font-medium text-text dark:text-[#F5F0EA]">
              {t("admin.approvals.rejectReason")}
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder={t("admin.approvals.rejectReasonPlaceholder")}
                className="mt-2 min-h-24 w-full rounded-xl border border-[#E5D8C7] bg-white p-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
              />
            </label>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => { setRejectModal(null); setRejectReason(""); }}>
                {t("actions.close")}
              </Button>
              <Button variant="danger" onClick={() => void handleReject()}>
                {t("admin.approvals.reject")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
