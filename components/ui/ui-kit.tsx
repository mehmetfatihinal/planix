"use client";

import Link from "next/link";
import type React from "react";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Bell,
  Building2,
  CalendarClock,
  Camera,
  Check,
  Clock3,
  Download,
  FileText,
  MapPin,
  MoreHorizontal,
  Plus,
  StickyNote,
  Trash2,
  UserCheck
} from "lucide-react";
import { getCompanyById, getModuleLabelKey } from "@/lib/app-state";
import {
  apiBlob,
  downloadPdf,
  uploadFile,
  RequestCompletionPhotoRequiredError
} from "@/lib/api-client";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { getPriorityKey, getStatusKey } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { useAppState } from "@/lib/app-state";
import { hasRouteDestination, openCompanyRoute } from "@/lib/web-location";
import type { Company, DocumentRecord, Offer, Task } from "@/types/business";

export function PageHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-normal text-text dark:text-[#F5F0EA] sm:text-3xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted dark:text-darkMuted">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className
}: Readonly<{
  children: React.ReactNode;
  className?: string;
}>) {
  return (
    <section className={cn("glass-border rounded-2xl bg-card p-4 shadow-soft dark:bg-darkCard sm:p-5", className)}>
      {children}
    </section>
  );
}

export function SectionTitle({
  title,
  subtitle,
  icon: Icon
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {Icon ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-beige text-primary dark:bg-[#2A2022] dark:text-darkPrimary">
          <Icon size={18} />
        </span>
      ) : null}
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-text dark:text-[#F5F0EA]">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm leading-5 text-muted dark:text-darkMuted">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
  title
}: {
  children: React.ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
  className?: string;
  title?: string;
}) {
  const tones = {
    neutral: "bg-beige/70 text-muted dark:bg-[#292522] dark:text-darkMuted",
    primary: "bg-primary/10 text-primary dark:bg-darkPrimary/15 dark:text-[#F3A4AF]",
    success: "bg-success/10 text-success dark:bg-success/15 dark:text-[#80D9B0]",
    warning: "bg-warning/10 text-warning dark:bg-warning/15 dark:text-[#F4C36F]",
    danger: "bg-danger/10 text-danger dark:bg-danger/15 dark:text-[#FCA5A5]"
  };

  return (
    <span
      title={title}
      className={cn(
        "inline-flex min-h-7 items-center rounded-full px-2.5 py-1 text-xs font-medium leading-none",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * Renders an image that may live behind the API's JWT wall. Paths starting with
 * "/" (e.g. "/files/<id>") are fetched as an authenticated blob and shown via an
 * object URL; absolute URLs render directly.
 */
export function AuthImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const isProtected = src.startsWith("/");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isProtected) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setObjectUrl(null);
    setFailed(false);
    apiBlob(src)
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [isProtected, src]);

  const resolvedSrc = isProtected ? objectUrl : src;
  if (failed) {
    return null;
  }
  if (!resolvedSrc) {
    return <span className={cn("inline-block animate-pulse rounded-lg bg-beige/70 dark:bg-[#2A2623]", className)} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolvedSrc} alt={alt} className={className} />;
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const variants = {
    primary: "bg-primary text-white shadow-sm hover:bg-primaryDark dark:bg-darkPrimary dark:hover:bg-primary",
    secondary:
      "border border-[#E5D8C7] bg-white text-text hover:border-primary/35 dark:border-darkBorder dark:bg-[#242424] dark:text-[#F5F0EA]",
    ghost: "text-muted hover:bg-beige/70 hover:text-text dark:text-darkMuted dark:hover:bg-[#252525] dark:hover:text-[#F5F0EA]",
    danger: "bg-danger text-white hover:bg-[#991B1B]"
  };

  return (
    <button
      {...props}
      className={cn(
        "focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon }) {
  return (
    <button
      {...props}
      title={label}
      aria-label={label}
      className={cn(
        "focus-ring inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E5D8C7] bg-white text-muted transition hover:border-primary/35 hover:text-primary dark:border-darkBorder dark:bg-[#242424] dark:text-darkMuted dark:hover:text-[#F5F0EA]",
        className
      )}
    >
      <Icon size={18} />
    </button>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "primary"
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    primary: "text-primary dark:text-darkPrimary",
    success: "text-success dark:text-[#80D9B0]",
    warning: "text-warning dark:text-[#F4C36F]",
    danger: "text-danger dark:text-[#FCA5A5]"
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted dark:text-darkMuted">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-text dark:text-[#F5F0EA]">{value}</p>
        </div>
        <span className={cn("rounded-xl bg-beige p-2 dark:bg-[#2A2022]", toneClass[tone])}>
          <Icon size={19} />
        </span>
      </div>
    </Card>
  );
}

export function TaskCard({
  task,
  compact = false,
  showRouteAction = false
}: {
  task: Task;
  compact?: boolean;
  showRouteAction?: boolean;
}) {
  const { data, language, t, markTaskDone, snoozeTask, acknowledgeTask, addTaskNote, deleteTask, updateTask } = useAppState();
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [completionNote, setCompletionNote] = useState("");
  const [submittingCompletion, setSubmittingCompletion] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [photoRequired, setPhotoRequired] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [reschedulingNow, setReschedulingNow] = useState(false);
  const company = getCompanyById(data, task.companyId);
  const modules = task.moduleIds
    .map((moduleId) => data.modules.find((module) => module.id === moduleId))
    .filter(Boolean);
  const isPending = task.status === "pending_approval";
  const isOverdue = task.status === "overdue";
  const isRejected = Boolean(task.lastRejectedAt) && task.status !== "done" && task.status !== "pending_approval";
  const isAssigned = Boolean(task.assignedByUserId);
  const needsAcknowledge = isAssigned && !task.acknowledgedAt && task.status !== "done";
  const showPhotoPicker = photoRequired || Boolean(task.requirePhotoProof);

  async function submitAcknowledge() {
    if (acknowledging) return;
    setAcknowledging(true);
    try {
      await acknowledgeTask(task.id);
    } finally {
      setAcknowledging(false);
    }
  }

  async function submitReschedule() {
    if (reschedulingNow || !rescheduleDate) return;
    setReschedulingNow(true);
    try {
      await updateTask(task.id, {
        ...task,
        dueDate: rescheduleDate,
        dueTime: rescheduleTime || null,
        status: "open",
        notificationsEnabled: true
      });
      setRescheduleOpen(false);
      setRescheduleDate("");
      setRescheduleTime("");
    } finally {
      setReschedulingNow(false);
    }
  }

  async function submitCompletion() {
    if (submittingCompletion) return;
    setSubmittingCompletion(true);
    setCompletionError(null);
    try {
      let photoFileId: string | null = null;
      if (photoFile) {
        const uploaded = await uploadFile(photoFile, "task-completion", task.id);
        photoFileId = uploaded.id;
      }
      await markTaskDone(task.id, completionNote, photoFileId);
      setCompletionModalOpen(false);
      setCompletionNote("");
      setPhotoFile(null);
      setPhotoRequired(false);
    } catch (error) {
      if (error instanceof RequestCompletionPhotoRequiredError) {
        // Backend demands photo proof → surface the picker and let the user retry.
        setPhotoRequired(true);
        setCompletionError(t("task.requiresPhoto"));
      } else {
        setCompletionError(error instanceof Error ? error.message : t("admin.users.actionFailed"));
      }
    } finally {
      setSubmittingCompletion(false);
    }
  }

  return (
    <article className="rounded-2xl border border-[#E8DECF] bg-white p-4 shadow-[0_8px_25px_rgba(31,31,31,0.04)] dark:border-darkBorder dark:bg-[#202020]">
      <div className={cn("gap-3", compact ? "flex flex-col" : "flex flex-col md:flex-row md:items-start md:justify-between")}>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {company ? (
              <Link
                href={`/companies/${company.id}`}
                className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-primary hover:underline dark:text-[#F3A4AF]"
              >
                <Building2 size={14} />
                <span className="truncate">{company.name}</span>
              </Link>
            ) : null}
            <Badge tone={task.priority === "high" ? "danger" : task.priority === "medium" ? "warning" : "neutral"}>
              {t(getPriorityKey(task.priority))}
            </Badge>
            <Badge tone={
              task.status === "overdue" ? "danger"
              : task.status === "done" ? "success"
              : task.status === "pending_approval" ? "warning"
              : "neutral"
            }>
              {t(getStatusKey(task.status))}
            </Badge>
            {isAssigned ? (
              <Badge tone="primary" className="gap-1">
                <UserCheck size={13} />
                {t("task.assignedBadge")}
              </Badge>
            ) : null}
            {task.delayReason ? (
              <Badge tone="warning" title={task.delayReason}>
                {t("task.delayReason")}: {task.delayReason}
              </Badge>
            ) : null}
          </div>
          <h3 className="break-words text-base font-semibold leading-6 text-text dark:text-[#F5F0EA]">{task.title}</h3>
          {!compact ? <p className="mt-2 text-sm leading-5 text-muted dark:text-darkMuted">{task.description}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {modules.map((module) =>
              module ? (
                <Link href={`/modules/${module.id}`} key={module.id}>
                  <Badge>{t(getModuleLabelKey(module))}</Badge>
                </Link>
              ) : null
            )}
          </div>
          {compact ? (
            <div className="mt-3 space-y-2 text-sm text-muted dark:text-darkMuted">
              <span className="flex flex-wrap items-center gap-2">
                <Clock3 size={15} className="shrink-0" />
                <span className="break-words">{task.timeWindow ?? task.dueTime ?? (task.dueDate ? formatShortDate(task.dueDate, language) : t("task.noDate"))}</span>
              </span>
              {task.reminderInterval ? (
                <span className="flex items-start gap-2">
                  <Bell size={15} className="mt-0.5 shrink-0" />
                  <span className="break-words leading-5">{task.reminderInterval}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {!compact ? (
        <div className="flex min-w-0 shrink-0 flex-col gap-2 text-sm text-muted dark:text-darkMuted md:max-w-[260px]">
          <span className="inline-flex flex-wrap items-center gap-2">
            <Clock3 size={15} />
            <span className="break-words">{task.timeWindow ?? task.dueTime ?? (task.dueDate ? formatShortDate(task.dueDate, language) : t("task.noDate"))}</span>
          </span>
          {task.reminderInterval ? (
            <span className="inline-flex items-start gap-2">
              <Bell size={15} className="mt-0.5 shrink-0" />
              <span className="break-words leading-5">{task.reminderInterval}</span>
            </span>
          ) : null}
        </div>
        ) : null}
      </div>
      {!compact && needsAcknowledge ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-text dark:border-darkPrimary/30 dark:bg-darkPrimary/10 dark:text-[#F5F0EA]">
          <span className="font-medium">{t("task.acknowledgeHint")}</span>
          <Button variant="secondary" disabled={acknowledging} onClick={() => void submitAcknowledge()}>
            <UserCheck size={16} />
            {acknowledging ? t("approval.submitting") : t("actions.acknowledgeTask")}
          </Button>
        </div>
      ) : null}
      {!compact && isPending ? (
        <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-[#2a2419] dark:text-amber-100">
          <strong className="font-semibold">{t("approval.pendingBadge")}</strong>
          {task.completionRequestedNote ? (
            <span className="ml-1 opacity-80">— {task.completionRequestedNote}</span>
          ) : null}
        </div>
      ) : null}
      {!compact && task.lastRejectedAt && task.status !== "done" && task.status !== "pending_approval" ? (
        <div className="mt-3 rounded-xl border border-red-300/40 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-400/40 dark:bg-[#2a1a1a] dark:text-red-100">
          <strong className="font-semibold">{t("approval.rejectedBadge")}</strong>
          {task.lastRejectionReason ? (
            <span className="ml-1 opacity-80">— {task.lastRejectionReason}</span>
          ) : null}
        </div>
      ) : null}
      {!compact && task.status === "done" ? (
        // Completed task → no Tamam/ertele/iptal; just allow viewing company / map.
        (company || (showRouteAction && company && hasRouteDestination(company))) ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {showRouteAction && company && hasRouteDestination(company) ? (
              <Button variant="ghost" onClick={() => openCompanyRoute(company)}>
                <MapPin size={16} />
                {t("actions.openInGoogleMaps")}
              </Button>
            ) : null}
            {company ? (
              <Link
                href={`/companies/${company.id}`}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-muted transition hover:bg-beige/70 hover:text-text dark:text-darkMuted dark:hover:bg-[#252525] dark:hover:text-[#F5F0EA]"
              >
                <Building2 size={16} />
                {t("actions.openCompany")}
              </Link>
            ) : null}
          </div>
        ) : null
      ) : !compact && isRejected ? (
        // Rejected task → only "Tamam" remains. Clicking it opens the completion
        // modal again; submitting re-sends to admin (clears rejection markers).
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setCompletionModalOpen(true)}
          >
            <Check size={16} />
            {t("actions.done")}
          </Button>
        </div>
      ) : !compact && isOverdue ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => {
            setRescheduleDate(task.dueDate ?? "");
            setRescheduleTime(task.dueTime ?? "");
            setRescheduleOpen(true);
          }}>
            <CalendarClock size={16} />
            {t("actions.reschedule")}
          </Button>
          <Button
            variant="danger"
            onClick={() => setConfirmCancelOpen(true)}
          >
            <Trash2 size={16} />
            {t("actions.delete")}
          </Button>
          {company ? (
            <Link
              href={`/companies/${company.id}`}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-muted transition hover:bg-beige/70 hover:text-text dark:text-darkMuted dark:hover:bg-[#252525] dark:hover:text-[#F5F0EA]"
            >
              <Building2 size={16} />
              {t("actions.openCompany")}
            </Link>
          ) : null}
        </div>
      ) : !compact ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={isPending}
            onClick={() => setCompletionModalOpen(true)}
          >
            <Check size={16} />
            {isPending ? t("approval.waitingForAdmin") : t("actions.done")}
          </Button>
          <Button variant="ghost" onClick={() => void snoozeTask(task.id, { hours: 1 })}>
            {t("actions.snoozeOneHour")}
          </Button>
          <Button variant="ghost" onClick={() => void snoozeTask(task.id, { hours: 2 })}>
            {t("actions.snoozeTwoHours")}
          </Button>
          <Button variant="ghost" onClick={() => addTaskNote(task.id)}>
            <StickyNote size={16} />
            {t("actions.addNote")}
          </Button>
          {showRouteAction && company && hasRouteDestination(company) ? (
            <Button variant="ghost" onClick={() => openCompanyRoute(company)}>
              <MapPin size={16} />
              {t("actions.openInGoogleMaps")}
            </Button>
          ) : null}
          <Button
            variant="danger"
            onClick={() => setConfirmCancelOpen(true)}
          >
            <Trash2 size={16} />
            {t("actions.cancelTask")}
          </Button>
          {company ? (
            <Link
              href={`/companies/${company.id}`}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-muted transition hover:bg-beige/70 hover:text-text dark:text-darkMuted dark:hover:bg-[#252525] dark:hover:text-[#F5F0EA]"
            >
              <Building2 size={16} />
              {t("actions.openCompany")}
            </Link>
          ) : null}
        </div>
      ) : null}
      {confirmCancelOpen ? (
        <ConfirmationDialog
          title={t("actions.cancelTask")}
          message={t("actions.cancelTaskConfirm")}
          confirmLabel={t("actions.cancelTask")}
          cancelLabel={t("actions.close")}
          onCancel={() => setConfirmCancelOpen(false)}
          onConfirm={() => {
            setConfirmCancelOpen(false);
            void deleteTask(task.id);
          }}
        />
      ) : null}
      {rescheduleOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#E8DECF] bg-white p-5 shadow-xl dark:border-darkBorder dark:bg-[#1f1f1f]">
            <h3 className="text-base font-semibold text-text dark:text-[#F5F0EA]">
              {t("actions.reschedule")}
            </h3>
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">
              {t("reschedule.subtitle")}
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-text dark:text-[#F5F0EA]">
                {t("reschedule.dateLabel")}
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(event) => setRescheduleDate(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                />
              </label>
              <label className="block text-sm font-medium text-text dark:text-[#F5F0EA]">
                {t("reschedule.timeLabel")}
                <input
                  type="time"
                  value={rescheduleTime}
                  onChange={(event) => setRescheduleTime(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => { setRescheduleOpen(false); setRescheduleDate(""); setRescheduleTime(""); }}>
                {t("actions.close")}
              </Button>
              <Button onClick={() => void submitReschedule()} disabled={reschedulingNow || !rescheduleDate}>
                {reschedulingNow ? t("reschedule.submitting") : t("reschedule.submit")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {completionModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#E8DECF] bg-white p-5 shadow-xl dark:border-darkBorder dark:bg-[#1f1f1f]">
            <h3 className="text-base font-semibold text-text dark:text-[#F5F0EA]">
              {t("approval.requestTitle")}
            </h3>
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">
              {t("approval.requestSubtitle")}
            </p>
            {completionError ? (
              <div className="mt-3 rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger dark:text-[#FCA5A5]">
                {completionError}
              </div>
            ) : null}
            <label className="mt-4 block text-sm font-medium text-text dark:text-[#F5F0EA]">
              {t("approval.noteLabel")}
              <textarea
                value={completionNote}
                onChange={(event) => setCompletionNote(event.target.value)}
                placeholder={t("approval.notePlaceholder")}
                className="mt-2 min-h-24 w-full rounded-xl border border-[#E5D8C7] bg-white p-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
              />
            </label>
            {showPhotoPicker ? (
              <label className="mt-3 block text-sm font-medium text-text dark:text-[#F5F0EA]">
                <span className="flex items-center gap-2">
                  <Camera size={15} />
                  {t("task.photoProofLabel")}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
                  className="mt-2 block w-full text-sm text-muted file:me-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:text-darkMuted dark:file:bg-darkPrimary"
                />
                {photoFile ? (
                  <span className="mt-1 block text-xs text-muted dark:text-darkMuted">{photoFile.name}</span>
                ) : null}
              </label>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setCompletionModalOpen(false);
                  setCompletionNote("");
                  setCompletionError(null);
                  setPhotoFile(null);
                  setPhotoRequired(false);
                }}
              >
                {t("actions.close")}
              </Button>
              <Button
                onClick={() => void submitCompletion()}
                disabled={submittingCompletion || (photoRequired && !photoFile)}
              >
                {submittingCompletion ? t("approval.submitting") : t("approval.submit")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ConfirmationDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-[#E8DECF] bg-[#FDFBF7] p-5 shadow-2xl dark:border-darkBorder dark:bg-[#1E1E1E]">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-danger/10 text-danger dark:bg-danger/15 dark:text-[#FCA5A5]">
            <Trash2 size={20} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-text dark:text-[#F5F0EA]">{title}</h2>
            <p className="mt-2 text-sm leading-5 text-muted dark:text-darkMuted">{message}</p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            <Trash2 size={16} />
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CompanyCard({ company }: { company: Company }) {
  const { t } = useAppState();
  return (
    <Link
      href={`/companies/${company.id}`}
      className="block rounded-2xl border border-[#E8DECF] bg-white p-4 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-soft dark:border-darkBorder dark:bg-[#202020]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-text dark:text-[#F5F0EA]">{company.name}</h3>
          <p className="mt-1 text-sm text-muted dark:text-darkMuted">{company.contactPerson}</p>
        </div>
        <Badge tone={company.status === "waitingPayment" ? "warning" : company.status === "followUp" ? "primary" : "neutral"}>
          {t(getStatusKey(company.status))}
        </Badge>
      </div>
      <p className="mt-3 flex items-start gap-2 text-sm leading-5 text-muted dark:text-darkMuted">
        <MapPin size={15} className="mt-0.5 shrink-0" />
        {company.address}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {company.addressVerified ? (
          <Badge tone="success" className="gap-1" title={company.formattedAddress ?? company.address}>
            <BadgeCheck size={13} />
            {t("company.addressVerified")}
          </Badge>
        ) : (
          <Badge tone="warning">{t("company.addressNotVerified")}</Badge>
        )}
        {company.tags.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
      </div>
    </Link>
  );
}

export function OfferCard({ offer }: { offer: Offer }) {
  const { data, language, t } = useAppState();
  const company = getCompanyById(data, offer.companyId);
  return (
    <article className="rounded-2xl border border-[#E8DECF] bg-white p-4 dark:border-darkBorder dark:bg-[#202020]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted dark:text-darkMuted">
            {offer.offerNumber}
          </p>
          <h3 className="mt-2 font-semibold text-text dark:text-[#F5F0EA]">{offer.title}</h3>
          <p className="mt-1 text-sm text-muted dark:text-darkMuted">{company?.name}</p>
        </div>
        <Badge tone={offer.status === "sent" ? "primary" : offer.status === "accepted" ? "success" : "neutral"}>
          {t(getStatusKey(offer.status))}
        </Badge>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-[#EFE4D3] pt-4 text-sm dark:border-darkBorder">
        <span className="text-muted dark:text-darkMuted">{t("common.total")}</span>
        <strong className="text-text dark:text-[#F5F0EA]">{formatCurrency(offer.total, language, offer.currency)}</strong>
      </div>
    </article>
  );
}

export function DocumentCard({ document }: { document: DocumentRecord }) {
  const { data, t } = useAppState();
  const company = getCompanyById(data, document.companyId);
  return (
    <article className="rounded-2xl border border-[#E8DECF] bg-white p-4 dark:border-darkBorder dark:bg-[#202020]">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-beige text-primary dark:bg-[#2A2022] dark:text-darkPrimary">
          <FileText size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-text dark:text-[#F5F0EA]">{document.fileName}</h3>
          <p className="mt-1 text-sm text-muted dark:text-darkMuted">{company?.name ?? t("sidebar.documents")}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-5 text-muted dark:text-darkMuted">{document.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge>{document.documentType}</Badge>
        <Badge>{document.fileType}</Badge>
      </div>
      {document.fileId ? (
        <div className="mt-3">
          <Button
            variant="secondary"
            className="min-h-8 px-2.5 py-1 text-xs"
            onClick={() => void downloadPdf(`/documents/${document.id}/filled-pdf`, `${document.fileName || "document"}-filled.pdf`).catch(() => undefined)}
          >
            <Download size={14} />
            {t("documents.filledPdf")}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function EmptyState({ title }: { title: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-[#D8CBBB] bg-white/50 p-6 text-center text-sm text-muted dark:border-darkBorder dark:bg-[#1E1E1E]/50 dark:text-darkMuted">
      {title}
    </div>
  );
}

export function MiniActionRail() {
  const { t } = useAppState();
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/capture" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primaryDark dark:bg-darkPrimary">
        <Plus size={16} />
        {t("actions.newVoiceNote")}
      </Link>
      <Link href="/offers" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#E5D8C7] bg-white px-3.5 py-2 text-sm font-medium text-text transition hover:border-primary/35 dark:border-darkBorder dark:bg-[#242424] dark:text-[#F5F0EA]">
        <FileText size={16} />
        {t("actions.createOffer")}
      </Link>
      <Link href="/ai-assistant" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E5D8C7] bg-white text-muted transition hover:border-primary/35 hover:text-primary dark:border-darkBorder dark:bg-[#242424] dark:text-darkMuted">
        <MoreHorizontal size={18} />
      </Link>
    </div>
  );
}
