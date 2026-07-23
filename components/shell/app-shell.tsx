"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BarChart3,
  BellDot,
  Bot,
  Building2,
  CalendarCheck2,
  ClipboardList,
  CreditCard,
  FileArchive,
  FileText,
  Home,
  Languages,
  LogOut,
  Map,
  Menu,
  Mic,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Sun,
  Upload,
  Users,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getModuleLabelKey, useAppState } from "@/lib/app-state";
import { apiRequest } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-state";
import { languages } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "@/components/ui/ui-kit";
import type { LanguageCode } from "@/types/business";

const primaryNav: Array<{ href: string; key: string; icon: LucideIcon }> = [
  { href: "/dashboard", key: "nav.dashboard", icon: Home },
  { href: "/today", key: "nav.today", icon: CalendarCheck2 },
  { href: "/weekly-analysis", key: "nav.weeklyAnalysis", icon: BarChart3 },
  { href: "/overdue", key: "nav.overdue", icon: BellDot },
  { href: "/route-planner", key: "nav.routePlanner", icon: Map },
  { href: "/ai-assistant", key: "nav.aiAssistant", icon: Bot },
  { href: "/capture", key: "nav.voiceInbox", icon: Mic },
  { href: "/shopping", key: "nav.shopping", icon: ShoppingCart },
  { href: "/settings", key: "nav.settings", icon: Settings }
];

const salesNav: Array<{ href: string; key: string; icon: LucideIcon }> = [
  { href: "/offers?view=create", key: "sales.createOffer", icon: FileText },
  { href: "/invoices?view=create", key: "sales.createInvoice", icon: ClipboardList },
  { href: "/products", key: "sales.productsPrices", icon: Package },
  { href: "/offers?view=packages", key: "sales.packages", icon: FileArchive },
  { href: "/offers?view=pending", key: "sales.pendingOffers", icon: BellDot },
  { href: "/invoices?view=waiting", key: "sales.waitingPayments", icon: CreditCard }
];

const documentsNav: Array<{ href: string; key: string; icon: LucideIcon }> = [
  { href: "/documents?type=pdf", key: "doc.pdfs", icon: FileText },
  { href: "/documents?type=photo", key: "doc.photos", icon: Upload },
  { href: "/documents?type=contract", key: "doc.contracts", icon: FileArchive },
  { href: "/documents?type=measurement", key: "doc.measurements", icon: ClipboardList },
  { href: "/documents?type=price-list", key: "doc.priceLists", icon: Package }
];

const archiveNav: Array<{ href: string; key: string; icon: LucideIcon }> = [
  { href: "/today?view=completed", key: "nav.completed", icon: Archive },
  { href: "/offers?view=lost", key: "nav.lostOffers", icon: FileArchive },
  { href: "/companies?view=archived", key: "nav.oldCompanies", icon: Building2 }
];

const adminNav: Array<{ href: string; key: string; icon: LucideIcon }> = [
  { href: "/admin", key: "admin.nav.overview", icon: ShieldCheck },
  { href: "/admin/approvals", key: "admin.nav.approvals", icon: Shield },
  { href: "/admin/users", key: "admin.nav.users", icon: Users },
  { href: "/admin/tasks", key: "admin.nav.tasks", icon: ClipboardList }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { language, t } = useAppState();
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const authRoute = pathname === "/login" || pathname === "/register";

  useEffect(() => {
    if (!loading && !user && !authRoute) {
      router.replace("/login");
    }
    if (!loading && user && authRoute) {
      router.replace("/dashboard");
    }
  }, [authRoute, loading, router, user]);

  if (authRoute) {
    return <>{children}</>;
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted dark:bg-darkBg dark:text-darkMuted">
        {t("app.name")}
      </div>
    );
  }

  return (
    <div className={cn("min-h-screen lg:flex", language === "ar" && "lg:flex-row-reverse")}>
      <DesktopSidebar />
      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="relative z-0 min-w-0 flex-1 overflow-x-hidden">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <NotificationPermissionBanner />
        <main className="mx-auto w-full max-w-[1500px] overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>
      <div className="sr-only" aria-live="polite">
        {t("settings.language")}
      </div>
    </div>
  );
}

function DesktopSidebar() {
  const { sidebarCollapsed, toggleSidebar, t } = useAppState();

  return (
    <aside
      className={cn(
        "sticky top-0 z-40 hidden h-screen shrink-0 border-[#E7DCCA] bg-[#FFFDF9]/88 backdrop-blur-xl dark:border-darkBorder dark:bg-[#161616]/92 lg:block",
        sidebarCollapsed ? "w-[88px]" : "w-[304px]",
        "border-r"
      )}
    >
      <SidebarContent collapsed={sidebarCollapsed} onClose={null} />
      <button
        onClick={toggleSidebar}
        title={sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        aria-label={sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        className="absolute -right-4 top-7 flex h-8 w-8 items-center justify-center rounded-full border border-[#E5D8C7] bg-white text-muted shadow-sm transition hover:text-primary dark:border-darkBorder dark:bg-[#242424] dark:text-darkMuted rtl:-left-4 rtl:right-auto"
      >
        {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
    </aside>
  );
}

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { language } = useAppState();

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button className="absolute inset-0 bg-black/35" aria-label="Close" onClick={onClose} />
      <aside
        className={cn(
          "premium-scroll absolute top-0 h-full w-[88vw] max-w-[340px] overflow-y-auto border-[#E7DCCA] bg-[#FFFDF9] shadow-2xl dark:border-darkBorder dark:bg-[#161616]",
          language === "ar" ? "right-0 border-l" : "left-0 border-r"
        )}
      >
        <SidebarContent collapsed={false} onClose={onClose} />
      </aside>
    </div>
  );
}

function SidebarContent({ collapsed, onClose }: { collapsed: boolean; onClose: (() => void) | null }) {
  const { data, t } = useAppState();
  const { user, token } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [companySearch, setCompanySearch] = useState("");
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

  const filteredCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase();
    return data.companies.filter((company) => company.name.toLowerCase().includes(query));
  }, [companySearch, data.companies]);

  // Poll pending-approval count for admins — keeps the red attention badge in sync.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!user?.isAdmin || !token) {
      setPendingApprovalCount(0);
      return;
    }
    let cancelled = false;
    const fetchCount = () => {
      apiRequest<Array<unknown>>("/admin/tasks/pending", {}, token)
        .then((rows) => { if (!cancelled) setPendingApprovalCount(rows.length); })
        .catch(() => undefined);
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [token, user?.isAdmin, pathname]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <div className="premium-scroll flex h-full flex-col overflow-y-auto px-3 py-4">
      <div className="mb-4 flex items-center gap-3 px-2">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/planix-logo.png" alt="Planix" className="h-full w-full object-cover" />
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-text dark:text-[#F5F0EA]">{t("app.name")}</p>
            <p className="truncate text-xs text-muted dark:text-darkMuted">{t("app.subtitle")}</p>
          </div>
        ) : null}
        {onClose ? <IconButton label={t("actions.close")} icon={X} onClick={onClose} className="ms-auto" /> : null}
      </div>

      <SidebarGroup collapsed={collapsed}>
        {primaryNav.map((item) => (
          <SidebarLink key={item.href + item.key} item={item} active={isActive(pathname, item.href, searchParams)} collapsed={collapsed} onClose={onClose} />
        ))}
      </SidebarGroup>

      <SidebarSection title={t("sidebar.workModules")} collapsed={collapsed}>
        {data.modules.map((module) => (
          <div key={module.id} className="group flex items-center gap-1">
            <SidebarLink
              item={{ href: `/modules/${module.id}`, key: getModuleLabelKey(module), icon: ClipboardList }}
              active={pathname === `/modules/${module.id}`}
              collapsed={collapsed}
              badge={module.taskCount}
              onClose={onClose}
            />
            {!collapsed ? (
              <button
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted opacity-0 transition hover:bg-beige hover:text-primary group-hover:opacity-100 dark:text-darkMuted dark:hover:bg-[#252525]"
                onClick={() => {
                  router.push(`/modules/${module.id}`);
                  onClose?.();
                }}
                title={t("actions.createTask")}
                aria-label={t("actions.createTask")}
              >
                <Plus size={16} />
              </button>
            ) : null}
          </div>
        ))}
      </SidebarSection>

      <Link
        href="/tasks"
        prefetch={false}
        onClick={onClose ?? undefined}
        title={t("nav.allTasks")}
        className={cn(
          "group relative mb-5 flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition shadow-sm",
          pathname === "/tasks"
            ? "bg-primary text-white ring-2 ring-primary/40 dark:bg-darkPrimary dark:ring-darkPrimary/40"
            : "bg-primary/10 text-primary ring-1 ring-primary/30 hover:bg-primary hover:text-white dark:bg-darkPrimary/15 dark:text-darkPrimary dark:hover:bg-darkPrimary dark:hover:text-white",
          collapsed && "justify-center px-2"
        )}
      >
        <ClipboardList size={18} className="shrink-0" />
        {!collapsed ? <span className="min-w-0 flex-1 truncate">{t("nav.allTasks")}</span> : null}
      </Link>

      <SidebarSection title={t("sidebar.companies")} collapsed={collapsed}>
        {!collapsed ? (
          <label className="mb-2 flex h-10 items-center gap-2 rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm text-muted dark:border-darkBorder dark:bg-[#222] dark:text-darkMuted">
            <Search size={16} />
            <input
              value={companySearch}
              onChange={(event) => setCompanySearch(event.target.value)}
              placeholder={t("sidebar.searchCompanies")}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted/70 dark:placeholder:text-darkMuted/70"
            />
          </label>
        ) : null}
        {filteredCompanies.map((company) => (
          <SidebarLink
            key={company.id}
            item={{ href: `/companies/${company.id}`, key: company.name, icon: Building2 }}
            active={pathname === `/companies/${company.id}`}
            collapsed={collapsed}
            onClose={onClose}
          />
        ))}
      </SidebarSection>

      <SidebarSection title={t("sidebar.sales")} collapsed={collapsed}>
        {salesNav.map((item) => (
          <SidebarLink
            key={item.key}
            item={item}
            active={isActive(pathname, item.href, searchParams)}
            collapsed={collapsed}
            badge={getSidebarBadgeCount(item.key, data)}
            onClose={onClose}
          />
        ))}
      </SidebarSection>

      <SidebarSection title={t("sidebar.documents")} collapsed={collapsed}>
        {documentsNav.map((item) => (
          <SidebarLink
            key={item.key}
            item={item}
            active={isActive(pathname, item.href, searchParams)}
            badge={getSidebarBadgeCount(item.key, data)}
            collapsed={collapsed}
            onClose={onClose}
          />
        ))}
      </SidebarSection>

      <SidebarSection title={t("sidebar.archive")} collapsed={collapsed}>
        {archiveNav.map((item) => (
          <SidebarLink
            key={item.key}
            item={item}
            active={isActive(pathname, item.href, searchParams)}
            badge={getSidebarBadgeCount(item.key, data)}
            collapsed={collapsed}
            onClose={onClose}
          />
        ))}
      </SidebarSection>

      {user?.isAdmin ? (
        <SidebarSection title={t("admin.nav.section")} collapsed={collapsed}>
          {adminNav.map((item) => {
            const isApprovals = item.href === "/admin/approvals";
            return (
              <SidebarLink
                key={item.key}
                item={item}
                active={pathname === item.href || (item.href !== "/admin" && pathname?.startsWith(item.href))}
                collapsed={collapsed}
                badge={isApprovals ? pendingApprovalCount : undefined}
                badgeTone={isApprovals ? "danger" : "neutral"}
                onClose={onClose}
              />
            );
          })}
          <HangfireLink collapsed={collapsed} />
        </SidebarSection>
      ) : null}
    </div>
  );
}

function HangfireLink({ collapsed }: { collapsed: boolean }) {
  const { token } = useAuth();
  const { t } = useAppState();
  const [busy, setBusy] = useState(false);

  async function open() {
    if (!token || busy) return;
    setBusy(true);
    try {
      // Set the hangfire-token cookie via /admin/hangfire-session, then open
      // the dashboard. The cookie scopes to /hangfire only.
      await apiRequest("/admin/hangfire-session", { method: "POST", body: "{}" }, token);
      const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000").replace(/\/$/, "");
      window.open(`${base}/hangfire`, "_blank", "noopener");
    } catch {
      // ignore — cookie may already be set; let the user retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      title={t("admin.nav.queue")}
      className={cn(
        "group flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
        "text-muted hover:bg-beige/75 hover:text-text dark:text-darkMuted dark:hover:bg-[#242424] dark:hover:text-[#F5F0EA]",
        collapsed && "justify-center px-2",
        busy && "opacity-60"
      )}
    >
      <ClipboardList size={18} className="shrink-0" />
      {!collapsed ? <span className="min-w-0 flex-1 truncate text-left">{t("admin.nav.queue")}</span> : null}
    </button>
  );
}

function SidebarGroup({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  return <nav className={cn("mb-4 space-y-1", collapsed && "space-y-2")}>{children}</nav>;
}

function SidebarSection({
  title,
  collapsed,
  children
}: {
  title: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      {!collapsed ? (
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted/80 dark:text-darkMuted">
          {title}
        </p>
      ) : null}
      <div className={cn("space-y-1", collapsed && "space-y-2")}>{children}</div>
    </div>
  );
}

function SidebarLink({
  item,
  active,
  collapsed,
  badge,
  badgeTone = "neutral",
  onClose
}: {
  item: { href: string; key: string; icon: LucideIcon };
  active: boolean;
  collapsed: boolean;
  badge?: number;
  badgeTone?: "neutral" | "danger";
  onClose: (() => void) | null;
}) {
  const { t } = useAppState();
  const Icon = item.icon;
  const label = item.key.includes(".") ? t(item.key) : item.key;
  const showAttentionDot = badgeTone === "danger" && typeof badge === "number" && badge > 0;

  return (
    <Link
      href={item.href}
      prefetch={false}
      onClick={onClose ?? undefined}
      title={label}
      className={cn(
        "group relative flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
        active
          ? "bg-primary text-white shadow-sm dark:bg-darkPrimary"
          : "text-muted hover:bg-beige/75 hover:text-text dark:text-darkMuted dark:hover:bg-[#242424] dark:hover:text-[#F5F0EA]",
        collapsed && "justify-center px-2"
      )}
    >
      <span className="relative shrink-0">
        <Icon size={18} />
        {collapsed && showAttentionDot ? (
          <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger/70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
          </span>
        ) : null}
      </span>
      {!collapsed ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
      {!collapsed && typeof badge === "number" && badge > 0 ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
            badgeTone === "danger"
              ? "bg-danger text-white"
              : active
                ? "bg-white/20 text-white"
                : "bg-white text-muted dark:bg-[#1B1B1B] dark:text-darkMuted"
          )}
        >
          {badgeTone === "danger" ? (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
          ) : null}
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { language, setLanguage, theme, setTheme, t } = useAppState();
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b border-[#E7DCCA] bg-background/78 backdrop-blur-xl dark:border-darkBorder dark:bg-darkBg/78">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <IconButton label={t("actions.open")} icon={Menu} onClick={onMenu} className="lg:hidden" />
        <label className="hidden h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm text-muted dark:border-darkBorder dark:bg-[#242424] dark:text-darkMuted sm:flex">
          <Search size={17} />
          <input
            placeholder={t("aiAssistant.placeholder")}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted/70 dark:placeholder:text-darkMuted/70"
          />
        </label>
        <div className="ms-auto flex items-center gap-2">
          <Link href="/capture" prefetch={false} className="hidden sm:inline-flex">
            <Button variant="secondary">
              <Mic size={16} />
              {t("actions.newVoiceNote")}
            </Button>
          </Link>
          <Link href="/documents" prefetch={false} className="hidden sm:inline-flex">
            <Button variant="secondary">
              <Upload size={16} />
              {t("actions.uploadDocument")}
            </Button>
          </Link>
          <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E5D8C7] bg-white px-2 text-sm text-muted dark:border-darkBorder dark:bg-[#242424] dark:text-darkMuted">
            <Languages size={17} />
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as LanguageCode)}
              className="max-w-28 bg-transparent text-sm outline-none sm:max-w-none"
              aria-label={t("settings.language")}
            >
              {languages.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <IconButton
            label={theme === "dark" ? t("settings.light") : t("settings.dark")}
            icon={theme === "dark" ? Sun : Moon}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          />
          <span className="hidden max-w-40 truncate text-sm font-medium text-muted dark:text-darkMuted xl:inline">
            {user?.name}
          </span>
          <IconButton label="Logout" icon={LogOut} onClick={logout} />
        </div>
      </div>
    </header>
  );
}

function NotificationPermissionBanner() {
  const { data, t } = useAppState();
  const { token } = useAuth();
  const [environment] = useState(() => {
    if (typeof window === "undefined") {
      return { supported: false, isAndroid: false };
    }

    const ua = window.navigator.userAgent.toLowerCase();
    return {
      isAndroid: ua.includes("android"),
      supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
    };
  });
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlightTimedTask, setHighlightTimedTask] = useState(false);
  const [status, setStatus] = useState<{ subscribed: boolean; publicKey?: string | null } | null>(null);
  const previousTimedTaskCount = useRef(0);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!token || !environment.supported) return;
    void apiRequest<{ subscribed: boolean; publicKey?: string | null }>("/notifications/status", {}, token)
      .then(setStatus)
      .catch(() => undefined);
  }, [environment.supported, token]);

  const timedTaskCount = data.tasks.filter((task) => task.status !== "done" && task.dueDate && task.dueTime).length;
  const hasTimedTask = timedTaskCount > 0;
  const permission = typeof window === "undefined" || !("Notification" in window) ? "default" : Notification.permission;
  const shouldShow = !dismissed && environment.supported && !!token && (!status?.subscribed || permission !== "granted") && (hasTimedTask || data.tasks.length > 0);
  const bannerDescription = highlightTimedTask
    ? "Zamanli bir gorev olusturdun. Gorev zamani yaklasirken hatirlatma almak icin bildirimleri simdi ac."
    : "Web ve Android uzerinde gorev saatinden once ve gorev aninda hatirlatma almak icin bildirimleri ac.";

  useEffect(() => {
    if (!token || permission === "granted") {
      setHighlightTimedTask(false);
      previousTimedTaskCount.current = timedTaskCount;
      return;
    }

    if (previousTimedTaskCount.current > 0 && timedTaskCount > previousTimedTaskCount.current) {
      setDismissed(false);
      setHighlightTimedTask(true);
    } else if (!hasTimedTask) {
      setHighlightTimedTask(false);
    }

    previousTimedTaskCount.current = timedTaskCount;
  }, [hasTimedTask, permission, timedTaskCount, token]);

  async function enableNotifications() {
    if (!token || !status?.publicKey) return;
    setBusy(true);
    try {
      const permissionResult = await Notification.requestPermission();
      if (permissionResult !== "granted") {
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(status.publicKey)
        }));

      const json = subscription.toJSON();
      await apiRequest(
        "/notifications/subscribe",
        {
          method: "POST",
          body: JSON.stringify({
            endpoint: json.endpoint,
            p256dh: json.keys?.p256dh,
            auth: json.keys?.auth,
            userAgent: navigator.userAgent,
            platform: environment.isAndroid ? "android-web" : "web"
          })
        },
        token
      );
      setStatus((current) => ({ ...(current ?? {}), subscribed: true, publicKey: current?.publicKey ?? status.publicKey }));
      setDismissed(true);
      setHighlightTimedTask(false);
    } finally {
      setBusy(false);
    }
  }

  if (!shouldShow) {
    return null;
  }

  return (
    <div className="border-b border-[#E7DCCA] bg-beige/70 px-4 py-3 dark:border-darkBorder dark:bg-[#1B1716]">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:px-2">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-darkPrimary/15 dark:text-[#F3A4AF]">
            <BellDot size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text dark:text-[#F5F0EA]">{t("actions.enableNotifications")}</p>
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">
              {bannerDescription}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setDismissed(true)}>
            {t("actions.close")}
          </Button>
          <Button onClick={() => void enableNotifications()} disabled={busy || !status?.publicKey}>
            {t("actions.enableNotifications")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

function isActive(pathname: string, href: string, currentSearch?: URLSearchParams | null) {
  const [hrefPath, hrefQuery = ""] = href.split("?");
  const cleanHref = hrefPath ?? href;
  if (href === "/dashboard") {
    return pathname === "/" || pathname === "/dashboard";
  }

  if (pathname !== cleanHref) return false;

  // Compare every key listed in the link's querystring (e.g. ?view=… or ?type=…)
  // so sibling links sharing a path don't all light up at once.
  if (!hrefQuery) {
    // Link has no query qualifier → active only when the URL also has no
    // discriminator that any sibling uses. To keep it simple, plain links are
    // active only when there is no querystring at all.
    return !currentSearch || Array.from(currentSearch.keys()).length === 0;
  }
  const linkParams = new URLSearchParams(hrefQuery);
  for (const [key, value] of linkParams.entries()) {
    if (currentSearch?.get(key) !== value) return false;
  }
  return true;
}

function getSidebarBadgeCount(key: string, data: ReturnType<typeof useAppState>["data"]) {
  switch (key) {
    case "sales.pendingOffers":
      return data.offers.filter((offer) => ["prepared", "sent", "followUpNeeded"].includes(offer.status)).length;
    case "sales.waitingPayments":
      return data.invoices.filter((invoice) => ["unpaid", "partiallyPaid", "overdue"].includes(invoice.status)).length;
    case "nav.completed":
      return data.tasks.filter((task) => task.status === "done").length;
    case "doc.pdfs":
      return data.documents.filter((document) => document.documentType.toLowerCase().includes("pdf")).length;
    default:
      return undefined;
  }
}

