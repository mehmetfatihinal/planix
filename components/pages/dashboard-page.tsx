"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bot,
  Building2,
  Calculator,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  CreditCard,
  Download,
  FileText,
  Link2,
  Map,
  MapPin,
  MessageSquareText,
  Mic,
  Package,
  Phone,
  Plus,
  ReceiptText,
  Route,
  ShoppingBag,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import {
  getCompanyById,
  getModuleLabelKey,
  getTodayTasks,
  getTomorrowTasks,
  useAppState
} from "@/lib/app-state";
import { formatCurrency, formatDate, formatNumber, formatPercent, formatShortDate, isoDate } from "@/lib/format";
import {
  downloadPdf,
  type DocumentScanResponse,
  type ReportRecord,
  type WeeklyAnalysisResponse
} from "@/lib/api-client";
import { getStatusKey, statusPipeline } from "@/lib/mock-data";
import { getLanguageMeta } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  buildTodayRoutePlan,
  describeRouteExclusion,
  type TodayRouteExcludedTask
} from "@/lib/today-route";
import {
  defaultBrowserLocationState,
  formatDistanceLabel,
  hasRouteDestination,
  openCompanyRoute,
  openMultiCompanyRoute,
  preopenExternalTab,
  rankResolutionCandidates,
  requestBrowserLocation,
  type BrowserLocationCoordinates,
  type BrowserLocationState
} from "@/lib/web-location";
import type { AiCaptureAnalysis, AiCaptureResponse, AiCompanyDraftRequest, AppData, Company, ErrandMatch, Invoice, LanguageCode, Offer, Task, TaskPriority, WorkModule } from "@/types/business";
import {
  AuthImage,
  Badge,
  Button,
  Card,
  CompanyCard,
  DocumentCard,
  EmptyState,
  MiniActionRail,
  OfferCard,
  PageHeader,
  SectionTitle,
  StatCard,
  TaskCard
} from "@/components/ui/ui-kit";
import { RecordManager } from "@/components/crud/record-manager";

type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
};

type BrowserSpeechRecognitionErrorEvent = {
  error: string;
};

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type DraftCompanyResolution = {
  detectedName: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  contactPerson: string;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

function normalizeAddressResolutions(result: AiCaptureResponse) {
  return result.addressResolutions?.length
    ? result.addressResolutions
    : result.addressResolution
      ? [result.addressResolution]
      : [];
}

function buildDraftCompanies(prompts: Array<{ detectedName: string; message: string }>): DraftCompanyResolution[] {
  return prompts.map((prompt) => ({
    detectedName: prompt.detectedName,
    name: prompt.detectedName,
    address: "",
    phone: "",
    email: "",
    contactPerson: ""
  }));
}

function formatRouteExclusionMessage(excludedTasks: TodayRouteExcludedTask[], language: LanguageCode) {
  if (!excludedTasks.length) {
    return null;
  }

  const names = Array.from(new Set(excludedTasks.map((item) => item.task.title))).slice(0, 3);
  const suffix = excludedTasks.length > names.length ? "..." : "";
  const label = names.join(", ");

  if (language === "tr") {
    return `${excludedTasks.length} gorev rotaya eklenmedi (${describeRouteExclusion(excludedTasks[0]!.reason)}): ${label}${suffix}`;
  }

  return `${excludedTasks.length} tasks were excluded from the route (${describeRouteExclusion(excludedTasks[0]!.reason)}): ${label}${suffix}`;
}

function hasUsableRouteCoordinates(latitude?: number | null, longitude?: number | null) {
  return typeof latitude === "number"
    && typeof longitude === "number"
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) > 0.000001
    && Math.abs(longitude) > 0.000001;
}

// "Rota üzeri alışveriş fırsatı": rota başlarken açık alışveriş maddelerini rota
// koridoruyla eşleştirir. Rota açılışını ASLA bloklamaz — çağrı ateşle-unut olarak
// tetiklenir, sonuç geldiğinde küçük bir panelde gösterilir.
function useRouteErrands() {
  const { fetchRouteErrands, fetchShoppingItems } = useAppState();
  const [matches, setMatches] = useState<ErrandMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const runErrandCheck = useCallback(
    async (stops: Company[], origin: BrowserLocationCoordinates | null) => {
      const coords: Array<[number, number]> = [];
      if (origin) {
        coords.push([origin.latitude, origin.longitude]);
      }
      for (const stop of stops) {
        if (hasUsableRouteCoordinates(stop.latitude, stop.longitude)) {
          coords.push([stop.latitude, stop.longitude]);
        }
      }
      if (coords.length === 0) return;

      setLoading(true);
      setMatches([]);
      try {
        // Yalnızca açık alışveriş maddesi varken sorgula.
        const items = await fetchShoppingItems();
        const hasOpenItems = items.some((item) => item.status !== "done");
        if (!hasOpenItems) return;

        const result = await fetchRouteErrands(coords);
        setMatches(result);
        if (result.length) {
          setPanelOpen(true);
        }
      } catch {
        // Rota açılışını etkilememesi için hata sessizce yutulur.
      } finally {
        setLoading(false);
      }
    },
    [fetchRouteErrands, fetchShoppingItems]
  );

  return { matches, loading, panelOpen, setPanelOpen, runErrandCheck };
}

function RouteErrandNotice({
  matches,
  loading,
  panelOpen,
  onOpen,
  onClose
}: {
  matches: ErrandMatch[];
  loading: boolean;
  panelOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { t } = useAppState();
  if (!loading && matches.length === 0) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        disabled={loading}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition hover:bg-primary/15 disabled:cursor-default disabled:opacity-70 dark:border-darkPrimary/30 dark:bg-darkPrimary/15 dark:text-darkPrimary"
      >
        <ShoppingBag size={14} />
        {loading ? t("errand.checking") : t("errand.indicator", { count: matches.length })}
      </button>
      {panelOpen && matches.length ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-[#E8DECF] bg-[#FDFBF7] p-5 shadow-2xl dark:border-darkBorder dark:bg-[#1E1E1E]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-text dark:text-[#F5F0EA]">
                  <ShoppingBag size={17} className="text-primary dark:text-darkPrimary" />
                  {t("errand.title")}
                </h3>
                <p className="mt-1 text-sm text-muted dark:text-darkMuted">{t("errand.subtitle")}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("actions.close")}
                className="shrink-0 rounded-lg p-1 text-muted transition hover:bg-black/5 hover:text-text dark:text-darkMuted dark:hover:bg-white/5 dark:hover:text-[#F5F0EA]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {matches.map((match, index) => {
                const distance = formatDistanceLabel(match.distanceToRouteMeters);
                const primary = match.chain?.trim() || match.shopName;
                return (
                  <div
                    key={`${match.itemId}-${match.shopName}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#E8DECF] bg-white p-3 dark:border-darkBorder dark:bg-[#202020]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text dark:text-[#F5F0EA]">{primary}</p>
                      <p className="mt-0.5 truncate text-xs text-muted dark:text-darkMuted">{match.itemName}</p>
                    </div>
                    {distance ? <Badge tone="primary" className="shrink-0">{`~${distance}`}</Badge> : null}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                {t("actions.close")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function DashboardPage() {
  const { data, t, language } = useAppState();
  const todayTasks = getTodayTasks(data);
  const pendingOffers = data.offers.filter((offer) => ["prepared", "sent", "followUpNeeded"].includes(offer.status));
  const overdueInvoices = data.invoices.filter((invoice) => invoice.status === "overdue");
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const completedThisWeek = data.tasks.filter((task) => {
    if (task.status !== "done" || !task.completedAt) return false;
    const completedAt = Date.parse(task.completedAt);
    return Number.isFinite(completedAt) && completedAt >= weekAgo;
  }).length;
  const followUps = data.companies.filter((company) => ["followUp", "waitingPayment", "offerSent"].includes(company.status));
  const [locationState, setLocationState] = useState<BrowserLocationState>(defaultBrowserLocationState);
  const todayRoutePlan = useMemo(
    () => buildTodayRoutePlan(todayTasks, data.companies, locationState.coordinates),
    [data.companies, locationState.coordinates, todayTasks]
  );
  const routeExclusionMessage = formatRouteExclusionMessage(todayRoutePlan.excludedTasks, language);
  const errands = useRouteErrands();

  async function startTodayRoute() {
    // Popup engellenmesin diye sekme tıklama anında senkron açılır (aşağıdaki await'ten önce).
    const pendingTab = preopenExternalTab();
    let nextState = locationState;
    if (locationState.status === "idle") {
      nextState = await requestBrowserLocation();
      setLocationState(nextState);
    }

    const nextPlan = buildTodayRoutePlan(todayTasks, data.companies, nextState.coordinates);
    if (!nextPlan.stops.length) {
      pendingTab?.close();
      window.alert(t("route.noStopsToday"));
      return;
    }

    // Rota üzeri alışveriş kontrolü — ateşle-unut, haritanın açılışını bloklamaz.
    void errands.runErrandCheck(nextPlan.stops.map((stop) => stop.company), nextState.coordinates);
    openMultiCompanyRoute(nextPlan.stops.map((stop) => stop.company), nextState.coordinates, pendingTab);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle")} action={<MiniActionRail />} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("dashboard.importantToday")} value={todayTasks.length} icon={CalendarClock} />
        <StatCard label={t("dashboard.pendingOffers")} value={pendingOffers.length} icon={FileText} tone="warning" />
        <StatCard label={t("dashboard.overduePayments")} value={overdueInvoices.length} icon={CreditCard} tone="danger" />
        <StatCard label={t("dashboard.followUpCompanies")} value={followUps.length} icon={Building2} tone="success" />
      </div>
      <RecordManager />

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <SectionTitle title={t("dashboard.quickCapture")} subtitle={t("dashboard.aiInsight")} icon={Mic} />
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <textarea
              className="min-h-28 rounded-2xl border border-[#E5D8C7] bg-[#FFFDF9] p-4 text-sm outline-none transition placeholder:text-muted/70 focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424] dark:placeholder:text-darkMuted/70"
              placeholder={t("dashboard.capturePlaceholder")}
              defaultValue={t("capture.transcriptPlaceholder")}
            />
            <div className="flex flex-row gap-2 md:flex-col">
              <Link href="/capture">
                <Button className="w-full">
                  <Sparkles size={16} />
                  {t("actions.analyze")}
                </Button>
              </Link>
              <Link href="/documents">
                <Button variant="secondary" className="w-full">
                  <Upload size={16} />
                  {t("actions.uploadDocument")}
                </Button>
              </Link>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["actions.newVoiceNote", Mic, "/capture"],
              ["actions.uploadDocument", Upload, "/documents"],
              ["actions.createOffer", FileText, "/offers"],
              ["actions.createInvoice", ReceiptText, "/invoices"],
              ["actions.askAssistant", Bot, "/ai-assistant"],
              ["actions.planRoute", Map, "/route-planner"]
            ].map(([key, Icon, href]) => (
              <Link
                href={href as string}
                key={key as string}
                className="flex min-h-12 items-center gap-3 rounded-xl border border-[#E8DECF] bg-white px-3 text-sm font-medium text-text transition hover:border-primary/30 hover:text-primary dark:border-darkBorder dark:bg-[#202020] dark:text-[#F5F0EA]"
              >
                <Icon size={17} />
                {t(key as string)}
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle title={t("dashboard.weekSummary")} icon={BarChart3} />
          <div className="space-y-3">
            {[
              [t("weeklyAnalysis.title"), String(completedThisWeek), CheckCircle2, "success"],
              [t("dashboard.pendingOffers"), String(pendingOffers.length), FileText, "warning"],
              [t("dashboard.waitingPayments"), formatCurrency(overdueInvoices.reduce((sum, invoice) => sum + invoice.total, 0), language), CreditCard, "danger"]
            ].map(([label, value, Icon, tone]) => (
              <div key={String(label)} className="flex items-center justify-between gap-3 rounded-xl bg-beige/50 p-3 dark:bg-[#24211F]">
                <span className="flex min-w-0 items-center gap-3 text-sm text-muted dark:text-darkMuted">
                  <Icon className={cn("shrink-0", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")} size={17} />
                  {label as string}
                </span>
                <strong className="shrink-0 text-text dark:text-[#F5F0EA]">{value as string}</strong>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle
            title={t("dashboard.nextBestActions")}
            subtitle={routeExclusionMessage
              ?? (!todayRoutePlan.stops.length
                ? t("route.noStopsToday")
                : language === "tr" ? "Bugune planli tum gorevler burada listelenir." : "All scheduled tasks for today are listed here.")}
            icon={Sparkles}
            />
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => void startTodayRoute()} disabled={!todayRoutePlan.stops.length}>
              <Route size={16} />
              {language === "tr" ? "Rotayi baslat" : "Start route"}
            </Button>
            <Badge tone={todayRoutePlan.stops.length ? "success" : "warning"}>
              {language === "tr"
                ? `${todayRoutePlan.stops.length} durak`
                : `${todayRoutePlan.stops.length} stops`}
            </Badge>
            <RouteErrandNotice
              matches={errands.matches}
              loading={errands.loading}
              panelOpen={errands.panelOpen}
              onOpen={() => errands.setPanelOpen(true)}
              onClose={() => errands.setPanelOpen(false)}
            />
          </div>
          <div className="space-y-3">
            {todayTasks.length ? todayTasks.map((task) => (
              <TaskCard key={task.id} task={task} compact />
            )) : <EmptyState title={t("empty.noTasks")} />}
          </div>
        </Card>
        <Card>
          <SectionTitle title={t("dashboard.hotLeads")} icon={Building2} />
          <div className="space-y-3">
            {followUps.length ? followUps.slice(0, 3).map((company) => (
              <CompanyCard key={company.id} company={company} />
            )) : <EmptyState title={t("empty.noCompany")} />}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle title={t("dashboard.waitingPayments")} icon={CreditCard} />
          <div className="space-y-3">
            {overdueInvoices.length ? overdueInvoices.map((invoice) => (
              <InvoiceSummary key={invoice.id} invoice={invoice} />
            )) : <EmptyState title={t("empty.noTasks")} />}
          </div>
        </Card>
        <Card>
          <SectionTitle title={t("dashboard.recentDocuments")} icon={FileText} />
          <div className="grid gap-3 sm:grid-cols-2">
            {data.documents.length ? data.documents.slice(0, 2).map((document) => (
              <DocumentCard key={document.id} document={document} />
            )) : <EmptyState title={t("empty.noDocuments")} />}
          </div>
        </Card>
      </div>
    </div>
  );
}

export function TodayPage() {
  const { data, t, language } = useAppState();
  const searchParams = useSearchParams();
  const view = searchParams.get("view");
  const today = getTodayTasks(data);
  const tomorrow = getTomorrowTasks(data);
  const completed = data.tasks.filter((task) => task.status === "done");
  const [locationState, setLocationState] = useState<BrowserLocationState>(defaultBrowserLocationState);
  const todayRoutePlan = useMemo(
    () => buildTodayRoutePlan(today, data.companies, locationState.coordinates),
    [data.companies, locationState.coordinates, today]
  );
  const routeExclusionMessage = formatRouteExclusionMessage(todayRoutePlan.excludedTasks, language);
  const errands = useRouteErrands();
  const groups = [
    { moduleId: "module-visits", key: "module.visits" },
    { moduleId: "module-calls", key: "module.calls" },
    { moduleId: "module-offers", key: "module.offers" },
    { moduleId: "module-payments", key: "module.payments" },
    { moduleId: "module-installation", key: "module.installation" },
    { moduleId: "module-support", key: "module.support" }
  ];

  async function startTodayRoute() {
    // Popup engellenmesin diye sekme tıklama anında senkron açılır (aşağıdaki await'ten önce).
    const pendingTab = preopenExternalTab();
    let nextState = locationState;
    if (locationState.status === "idle") {
      nextState = await requestBrowserLocation();
      setLocationState(nextState);
    }

    const nextPlan = buildTodayRoutePlan(today, data.companies, nextState.coordinates);
    if (!nextPlan.stops.length) {
      pendingTab?.close();
      window.alert(t("route.noStopsToday"));
      return;
    }

    // Rota üzeri alışveriş kontrolü — ateşle-unut, haritanın açılışını bloklamaz.
    void errands.runErrandCheck(nextPlan.stops.map((stop) => stop.company), nextState.coordinates);
    openMultiCompanyRoute(nextPlan.stops.map((stop) => stop.company), nextState.coordinates, pendingTab);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("today.title")} subtitle={t("today.subtitle")} action={<MiniActionRail />} />
      {view !== "completed" ? (
        <Card>
          <SectionTitle
            title={language === "tr" ? "Bugunun rota plani" : "Today's route plan"}
            subtitle={routeExclusionMessage
              ?? (!todayRoutePlan.stops.length
                ? t("route.noStopsToday")
                : language === "tr" ? "Firma baglamli bugun gorevlerinden rota olustur." : "Build a route from today's company tasks.")}
            icon={Route}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void startTodayRoute()} disabled={!todayRoutePlan.stops.length}>
              <Route size={16} />
              {language === "tr" ? "Rotayi baslat" : "Start route"}
            </Button>
            <Badge tone={todayRoutePlan.stops.length ? "success" : "warning"}>
              {language === "tr"
                ? `${todayRoutePlan.stops.length} durak`
                : `${todayRoutePlan.stops.length} stops`}
            </Badge>
            {todayRoutePlan.excludedTasks.length ? (
              <Badge tone="danger">
                {language === "tr"
                  ? `${todayRoutePlan.excludedTasks.length} gorev disarida`
                  : `${todayRoutePlan.excludedTasks.length} excluded`}
              </Badge>
            ) : null}
            <RouteErrandNotice
              matches={errands.matches}
              loading={errands.loading}
              panelOpen={errands.panelOpen}
              onOpen={() => errands.setPanelOpen(true)}
              onClose={() => errands.setPanelOpen(false)}
            />
          </div>
        </Card>
      ) : null}
      {view === "completed" ? (
        <Card>
          <SectionTitle title={t("nav.completed")} subtitle={formatShortDate(isoDate(0), language)} icon={CheckCircle2} />
          <div className="space-y-3">
            {completed.length ? completed.map((task) => <TaskCard key={task.id} task={task} />) : <EmptyState title={t("empty.noTasks")} />}
          </div>
        </Card>
      ) : null}
      {view !== "completed" ? (
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {groups.map((group) => {
            const tasks = today.filter((task) => task.moduleIds.includes(group.moduleId));
            return (
              <Card key={group.moduleId}>
                <SectionTitle title={t(group.key)} icon={ClipboardList} />
                <div className="space-y-3">
                  {tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task} showRouteAction />) : <EmptyState title={t("empty.noTasks")} />}
                </div>
              </Card>
            );
          })}
        </div>
        <Card className="h-fit">
          <SectionTitle title={t("common.due")} subtitle={formatShortDate(isoDate(1), language)} icon={CalendarClock} />
          <div className="space-y-3">
            {tomorrow.length ? tomorrow.map((task) => <TaskCard key={task.id} task={task} compact showRouteAction />) : <EmptyState title={t("empty.noTasks")} />}
          </div>
        </Card>
      </div>
      ) : null}
    </div>
  );
}

function shiftWeekStart(weekStart: string, days: number) {
  const date = new Date(`${weekStart}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function WeeklyAnalysisPage() {
  const { t, language, fetchWeeklyAnalysis } = useAppState();
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined);
  const [analysis, setAnalysis] = useState<WeeklyAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    fetchWeeklyAnalysis(weekStart)
      .then((result) => {
        if (!cancelled) setAnalysis(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : t("weekly.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWeeklyAnalysis, t, weekStart]);

  const totals = analysis?.totals ?? null;
  const currentWeekStart = analysis?.weekStart ?? weekStart ?? isoDate(0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("weeklyAnalysis.title")}
        subtitle={t("weeklyAnalysis.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setWeekStart(shiftWeekStart(currentWeekStart, -7))}>
              <ChevronLeft size={16} />
              {t("weekly.prevWeek")}
            </Button>
            <Button variant="secondary" onClick={() => setWeekStart(shiftWeekStart(currentWeekStart, 7))}>
              {t("weekly.nextWeek")}
              <ChevronRight size={16} />
            </Button>
          </div>
        }
      />
      {analysis ? (
        <Badge tone="primary">
          {formatShortDate(analysis.weekStart, language)} – {formatShortDate(analysis.weekEnd, language)}
        </Badge>
      ) : null}
      {errorMessage ? (
        <div className="rounded-2xl border border-danger/25 bg-danger/10 p-4 text-sm text-danger dark:text-[#FCA5A5]">
          {errorMessage}
        </div>
      ) : null}
      {loading && !analysis ? (
        <Card>
          <p className="text-sm text-muted dark:text-darkMuted">{t("admin.loading")}</p>
        </Card>
      ) : null}
      {totals ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t("weekly.completedTasks")} value={totals.completedTasks} icon={CheckCircle2} tone="success" />
            <StatCard label={t("weekly.overdueTasks")} value={totals.overdueTasks} icon={AlertTriangle} tone="danger" />
            <StatCard label={t("weekly.visits")} value={totals.visits} icon={MapPin} />
            <StatCard label={t("weekly.routes")} value={totals.routes} icon={Route} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t("weekly.acceptedOffers")} value={totals.acceptedOffers} icon={FileText} tone="success" />
            <StatCard label={t("weekly.openOffers")} value={totals.openOffers} icon={FileText} tone="warning" />
            <StatCard label={t("weekly.unpaidTotal")} value={formatCurrency(totals.unpaidInvoiceTotal, language)} icon={CreditCard} tone="danger" />
            <StatCard label={t("weekly.paidThisWeek")} value={formatCurrency(totals.paidThisWeek, language)} icon={CreditCard} tone="success" />
          </div>
        </>
      ) : null}
      {analysis ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <SectionTitle title={t("weekly.routeList")} icon={Route} />
            <div className="space-y-3">
              {analysis.routes.length ? analysis.routes.map((route) => (
                <div key={route.id} className="rounded-2xl border border-[#E8DECF] bg-white p-4 dark:border-darkBorder dark:bg-[#202020]">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-text dark:text-[#F5F0EA]">{formatShortDate(route.date, language)}</strong>
                    <Badge tone={route.status === "completed" ? "success" : "neutral"}>{route.status}</Badge>
                    <Badge>{route.source}</Badge>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {route.stops.map((stop, index) => (
                      <div key={`${route.id}-${stop.companyId}-${index}`} className="flex items-center gap-2 text-sm text-muted dark:text-darkMuted">
                        {stop.visitedAt ? (
                          <CheckCircle2 size={15} className="shrink-0 text-success" />
                        ) : (
                          <Clock3 size={15} className="shrink-0" />
                        )}
                        <span className="min-w-0 truncate">{stop.companyName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )) : <EmptyState title={t("empty.noTasks")} />}
            </div>
          </Card>
          <Card>
            <SectionTitle title={t("weekly.topCompanies")} icon={Building2} />
            <div className="space-y-2">
              {analysis.visitsByCompany.length ? analysis.visitsByCompany.map((entry) => (
                <div key={entry.companyId} className="flex items-center justify-between gap-3 rounded-xl bg-beige/50 p-3 text-sm dark:bg-[#24211F]">
                  <span className="min-w-0 truncate text-text dark:text-[#F5F0EA]">{entry.companyName}</span>
                  <Badge tone="primary">{formatNumber(entry.count, language)}</Badge>
                </div>
              )) : <EmptyState title={t("empty.noCompany")} />}
            </div>
          </Card>
        </div>
      ) : null}
      {analysis ? (
        <Card>
          <SectionTitle title={t("weekly.overdueTable")} icon={AlertTriangle} />
          {analysis.overdueTasks.length ? (
            <div className="premium-scroll overflow-x-auto rounded-2xl border border-[#E8DECF] dark:border-darkBorder">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-beige/60 text-muted dark:bg-[#24211F] dark:text-darkMuted">
                  <tr>
                    {[t("quickTask.taskTitle"), t("common.company"), t("common.due"), t("weekly.delayHours"), t("weekly.reason")].map((header) => (
                      <th key={header} className="px-4 py-3 text-start font-medium">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE4D3] dark:divide-darkBorder">
                  {analysis.overdueTasks.map((task) => (
                    <tr key={task.id}>
                      <td className="px-4 py-3 font-medium text-text dark:text-[#F5F0EA]">
                        {task.title}
                        {task.recurring ? <Badge className="ms-2">{t("weekly.recurring")}</Badge> : null}
                      </td>
                      <td className="px-4 py-3 text-muted dark:text-darkMuted">{task.company ?? "-"}</td>
                      <td className="px-4 py-3 text-muted dark:text-darkMuted">
                        {task.dueDate ? formatShortDate(task.dueDate, language) : "-"} {task.dueTime ?? ""}
                      </td>
                      <td className="px-4 py-3">{formatNumber(task.delayHours, language)}</td>
                      <td className="px-4 py-3 text-muted dark:text-darkMuted">{task.delayReason ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t("empty.noTasks")} />
          )}
        </Card>
      ) : null}
    </div>
  );
}

function computeDelayHours(task: Task): number | null {
  if (!task.dueDate) return null;
  const due = new Date(`${task.dueDate}T${task.dueTime ?? "23:59"}:00`);
  if (Number.isNaN(due.getTime())) return null;
  const diffMs = Date.now() - due.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / 3_600_000);
}

function formatDelayLabel(hours: number | null, t: (key: string, params?: Record<string, string | number>) => string) {
  if (hours === null) return null;
  if (hours >= 24) return t("overdue.delayDays", { days: Math.floor(hours / 24) });
  return t("overdue.delayHours", { hours });
}

const SNOOZE_HOUR_OPTIONS = [1, 2, 4, 8, 24, 48];

export function OverduePage() {
  const { data, t, language, snoozeTask, fetchReports } = useAppState();
  const overdueTasks = data.tasks.filter((task) => task.status === "overdue");
  const overdueInvoices = data.invoices.filter((invoice) => invoice.status === "overdue");
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [snoozeTarget, setSnoozeTarget] = useState<Task | null>(null);
  const [snoozeHours, setSnoozeHours] = useState(2);
  const [snoozeReason, setSnoozeReason] = useState("");
  const [snoozing, setSnoozing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchReports(undefined, 10)
      .then((rows) => {
        if (!cancelled) setReports(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchReports]);

  async function submitSnooze() {
    if (!snoozeTarget || !snoozeReason.trim() || snoozing) return;
    setSnoozing(true);
    try {
      await snoozeTask(snoozeTarget.id, { hours: snoozeHours, reason: snoozeReason.trim() });
      setSnoozeTarget(null);
      setSnoozeReason("");
    } finally {
      setSnoozing(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("overdue.title")} subtitle={t("overdue.subtitle")} />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card>
          <SectionTitle title={t("nav.overdue")} icon={AlertTriangle} />
          <div className="space-y-3">
            {overdueTasks.length ? overdueTasks.map((task) => {
              const delayLabel = formatDelayLabel(computeDelayHours(task), t);
              return (
                <div key={task.id} className="space-y-2">
                  <TaskCard task={task} showRouteAction />
                  <div className="flex flex-wrap items-center gap-2 px-1">
                    {delayLabel ? <Badge tone="danger">{delayLabel}</Badge> : null}
                    {task.delayReason ? <Badge tone="warning">{t("task.delayReason")}: {task.delayReason}</Badge> : null}
                    <Button
                      variant="secondary"
                      className="min-h-8 px-2.5 py-1 text-xs"
                      onClick={() => {
                        setSnoozeTarget(task);
                        setSnoozeHours(2);
                        setSnoozeReason("");
                      }}
                    >
                      <Clock3 size={14} />
                      {t("actions.snooze")}
                    </Button>
                  </div>
                </div>
              );
            }) : <EmptyState title={t("empty.noTasks")} />}
          </div>
        </Card>
        <div className="space-y-5">
          <Card className="h-fit">
            <SectionTitle title={t("dashboard.overduePayments")} icon={CreditCard} />
            <div className="space-y-3">
              {overdueInvoices.length ? overdueInvoices.map((invoice) => (
                <InvoiceSummary key={invoice.id} invoice={invoice} />
              )) : <EmptyState title={t("empty.noTasks")} />}
            </div>
          </Card>
          <Card className="h-fit">
            <SectionTitle title={t("overdue.reports")} icon={BarChart3} />
            <div className="space-y-2">
              {reports.length ? reports.map((report) => (
                <div key={report.id} className="rounded-xl border border-[#E8DECF] bg-white p-3 text-sm dark:border-darkBorder dark:bg-[#202020]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={report.kind === "weekly" ? "primary" : "neutral"}>
                      {t(report.kind === "weekly" ? "overdue.reportWeekly" : "overdue.reportDaily")}
                    </Badge>
                    <span className="text-muted dark:text-darkMuted">{formatShortDate(report.date, language)}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted dark:text-darkMuted">
                    {t("overdue.reportSummary", {
                      overdue: report.payload?.overdue?.length ?? 0,
                      recurring: report.payload?.recurring?.length ?? 0
                    })}
                  </p>
                </div>
              )) : <EmptyState title={t("overdue.reportsEmpty")} />}
            </div>
          </Card>
        </div>
      </div>
      {snoozeTarget ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-[#E8DECF] bg-[#FDFBF7] p-5 shadow-2xl dark:border-darkBorder dark:bg-[#1E1E1E]">
            <h3 className="text-base font-semibold text-text dark:text-[#F5F0EA]">{t("snooze.title")}</h3>
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">{snoozeTarget.title}</p>
            <label className="mt-4 block text-sm font-medium text-text dark:text-[#F5F0EA]">
              {t("snooze.hoursLabel")}
              <select
                value={snoozeHours}
                onChange={(event) => setSnoozeHours(Number(event.target.value))}
                className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
              >
                {SNOOZE_HOUR_OPTIONS.map((hours) => (
                  <option key={hours} value={hours}>
                    {hours} {t("snooze.hoursSuffix")}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm font-medium text-text dark:text-[#F5F0EA]">
              {t("snooze.reasonLabel")}
              <textarea
                value={snoozeReason}
                onChange={(event) => setSnoozeReason(event.target.value)}
                placeholder={t("snooze.reasonPlaceholder")}
                className="mt-2 min-h-24 w-full rounded-xl border border-[#E5D8C7] bg-white p-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
              />
            </label>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setSnoozeTarget(null)}>
                {t("actions.close")}
              </Button>
              <Button onClick={() => void submitSnooze()} disabled={snoozing || !snoozeReason.trim()}>
                {snoozing ? t("reschedule.submitting") : t("actions.snooze")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RoutePlannerPage() {
  const { data, t, language } = useAppState();
  const [locationState, setLocationState] = useState<BrowserLocationState>(defaultBrowserLocationState);
  const routeEligibleTasks = getTodayTasks(data);
  const todayRoutePlan = useMemo(
    () => buildTodayRoutePlan(routeEligibleTasks, data.companies, locationState.coordinates),
    [data.companies, locationState.coordinates, routeEligibleTasks]
  );
  const firstRouteCompany = todayRoutePlan.stops[0]?.company ?? null;
  const routeSummaryMessage = formatRouteExclusionMessage(todayRoutePlan.excludedTasks, language);
  const errands = useRouteErrands();

  async function startTodayRoute() {
    // Popup engellenmesin diye sekme tıklama anında senkron açılır (aşağıdaki await'ten önce).
    const pendingTab = preopenExternalTab();
    let nextState = locationState;
    if (locationState.status === "idle") {
      nextState = await requestBrowserLocation();
      setLocationState(nextState);
    }

    const nextPlan = buildTodayRoutePlan(routeEligibleTasks, data.companies, nextState.coordinates);
    if (!nextPlan.stops.length) {
      pendingTab?.close();
      window.alert(t("route.noStopsToday"));
      return;
    }

    // Rota üzeri alışveriş kontrolü — ateşle-unut, haritanın açılışını bloklamaz.
    void errands.runErrandCheck(nextPlan.stops.map((stop) => stop.company), nextState.coordinates);
    openMultiCompanyRoute(nextPlan.stops.map((stop) => stop.company), nextState.coordinates, pendingTab);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("routePlanner.title")}
        subtitle={t("routePlanner.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void startTodayRoute()} disabled={!todayRoutePlan.stops.length}>
              <Route size={16} />
              {language === "tr" ? "Rotayi baslat" : "Start route"}
            </Button>
            <RouteErrandNotice
              matches={errands.matches}
              loading={errands.loading}
              panelOpen={errands.panelOpen}
              onOpen={() => errands.setPanelOpen(true)}
              onClose={() => errands.setPanelOpen(false)}
            />
          </div>
        }
      />
      {!todayRoutePlan.stops.length ? (
        <Card>
          <p className="text-sm text-muted dark:text-darkMuted">{t("route.noStopsToday")}</p>
        </Card>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="min-h-[420px]">
          <SectionTitle title={t("routePlanner.mapPlaceholder")} icon={Map} />
          <div className="relative min-h-[330px] overflow-hidden rounded-2xl border border-[#E8DECF] bg-[#F1E7D8] dark:border-darkBorder dark:bg-[#24211F]">
            <div className="absolute inset-6 rounded-[2rem] border border-primary/15" />
            {todayRoutePlan.stops.map((stop, index) => {
              const company = stop.company;
              const stopNumber = index + 1;
              return (
                <div
                  key={company.id}
                  className="absolute flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white shadow-premium dark:bg-darkPrimary"
                  style={{ left: `${18 + index * 26}%`, top: `${22 + (index % 2) * 34}%` }}
                >
                  {stopNumber}
                  <span className="absolute top-14 whitespace-nowrap rounded-full bg-white px-2 py-1 text-xs text-text shadow-sm dark:bg-[#1F1F1F] dark:text-[#F5F0EA]">
                    {company?.name}
                  </span>
                </div>
              );
            })}
            {!todayRoutePlan.stops.length ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted dark:text-darkMuted">
                {t("empty.noTasks")}
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!firstRouteCompany || !hasRouteDestination(firstRouteCompany)}
              onClick={() => firstRouteCompany && openCompanyRoute(firstRouteCompany)}
            >
              {t("actions.openInGoogleMaps")}
            </Button>
            <Button variant="ghost">{t("actions.markVisited")}</Button>
            <Button variant="ghost">{t("actions.addVisitNote")}</Button>
            <Button variant="ghost">{t("actions.snoozeVisit")}</Button>
          </div>
        </Card>
        <div className="space-y-5">
          <Card>
            <SectionTitle title={t("routePlanner.optimizedOrder")} icon={ClipboardList} />
            <div className="space-y-3">
              {todayRoutePlan.stops.map((stop, index) => {
                const company = stop.company;
                const stopNumber = index + 1;
                const nextTask = stop.tasks
                  .slice()
                  .sort((left, right) => {
                    const leftDate = `${left.dueDate ?? "9999-12-31"}T${left.dueTime ?? "23:59"}`;
                    const rightDate = `${right.dueDate ?? "9999-12-31"}T${right.dueTime ?? "23:59"}`;
                    return leftDate.localeCompare(rightDate);
                  })[0];
                const distanceLabel = stop.distanceMeters !== null
                  ? `${(stop.distanceMeters / 1000).toFixed(stop.distanceMeters >= 1000 ? 1 : 2)} km`
                  : language === "tr"
                    ? "Saat sirasiyla"
                    : "Ordered by time";
                const subtitle = nextTask?.dueTime
                  ? language === "tr"
                    ? `Ilk gorev ${nextTask.dueTime}`
                    : `First task ${nextTask.dueTime}`
                  : language === "tr"
                    ? "Saat bilgisi yok"
                    : "No time set";
                return (
                  <Link
                    href={`/companies/${company.id}`}
                    key={company.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#E8DECF] bg-white p-3 dark:border-darkBorder dark:bg-[#202020]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-beige text-primary dark:bg-[#2A2022] dark:text-darkPrimary">
                        {stopNumber}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-text dark:text-[#F5F0EA]">{company.name}</span>
                        <span className="block text-sm text-muted dark:text-darkMuted">{subtitle}</span>
                      </span>
                    </span>
                    <Badge>{distanceLabel}</Badge>
                  </Link>
                );
              })}
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label={t("routePlanner.totalDistance")} value={`${todayRoutePlan.stops.length} ${language === "tr" ? "durak" : "stops"}`} icon={Map} />
            <StatCard label={t("routePlanner.totalDuration")} value={routeSummaryMessage ?? (language === "tr" ? "Hazir" : "Ready")} icon={Clock3} />
          </div>
          <Card>
            <SectionTitle title={t("module.visits")} icon={CalendarClock} />
            <div className="space-y-3">
              {routeEligibleTasks.slice(0, 3).map((task) => (
                <TaskCard key={task.id} task={task} compact />
              ))}
            </div>
          </Card>
          <Card>
            <SectionTitle title={t("company.address")} subtitle={t("empty.noCompany")} icon={AlertTriangle} />
            <div className="space-y-3">
              {todayRoutePlan.excludedTasks.length ? todayRoutePlan.excludedTasks.map((item) => <TaskCard key={item.task.id} task={item.task} compact />) : <EmptyState title={t("empty.noTasks")} />}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const assistantQuickActions: Array<{ key: string; href: string }> = [
  { key: "actions.createOffer", href: "/offers?view=create" },
  { key: "actions.createTask", href: "/tasks" },
  { key: "actions.openCompany", href: "/companies" },
  { key: "actions.addFollowUp", href: "/tasks" },
  { key: "actions.generatePdf", href: "/offers" },
  { key: "actions.planRoute", href: "/route-planner" }
];

export function AssistantPage() {
  const { data, t, language, assistantAsk } = useAppState();
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    { role: "assistant", content: t("aiAssistant.subtitle") }
  ]);
  const [input, setInput] = useState(t("aiAssistant.sampleQuestion"));
  const [thinking, setThinking] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function speakAnswer(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = getLanguageMeta(language).locale;
    window.speechSynthesis.speak(utterance);
  }

  async function sendMessage() {
    const query = input.trim();
    if (!query || thinking) {
      return;
    }
    setMessages((current) => [...current, { role: "user", content: query }]);
    setInput("");
    setThinking(true);
    let answer: string;
    try {
      answer = await assistantAsk(query);
    } catch {
      // 503 (AI not configured) or network error → local keyword answer.
      answer = answerFromData(query, data, t, language);
    }
    setThinking(false);
    setMessages((current) => [...current, { role: "assistant", content: answer }]);
    if (speakEnabled) {
      speakAnswer(answer);
    }
  }

  function toggleListening() {
    if (isListening) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);
      return;
    }

    const SpeechRecognitionConstructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionConstructor) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionConstructor();
    const initial = input.trim() ? `${input.trim()} ` : "";
    let committed = initial;

    recognition.lang = getLanguageMeta(language).locale;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += text;
        } else {
          interimText += text;
        }
      }
      if (finalText) {
        committed = `${committed}${finalText} `;
      }
      setInput(`${committed}${interimText}`.trimStart());
    };
    recognition.onerror = () => {
      setIsListening(false);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("aiAssistant.title")}
        subtitle={t("aiAssistant.subtitle")}
        action={
          <Button
            variant={speakEnabled ? "primary" : "secondary"}
            onClick={() => {
              if (speakEnabled && typeof window !== "undefined" && "speechSynthesis" in window) {
                window.speechSynthesis.cancel();
              }
              setSpeakEnabled((current) => !current);
            }}
            title={t(speakEnabled ? "assistant.speakOn" : "assistant.speakOff")}
          >
            {speakEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            {t(speakEnabled ? "assistant.speakOn" : "assistant.speakOff")}
          </Button>
        }
      />
      <Card className="min-h-[70vh] p-0">
        <div className="premium-scroll flex max-h-[calc(100vh-240px)] min-h-[440px] flex-col gap-4 overflow-y-auto p-4 sm:p-6">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={cn("max-w-[86%] rounded-2xl p-4 text-sm leading-6", message.role === "assistant" ? "bg-beige/70 text-text dark:bg-[#24211F] dark:text-[#F5F0EA]" : "ms-auto bg-primary text-white dark:bg-darkPrimary")}>
              {message.content}
                  {message.role === "assistant" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {assistantQuickActions.map((action) => (
                    <Link
                      key={action.key}
                      href={action.href}
                      prefetch={false}
                      className="inline-flex min-h-8 items-center justify-center gap-2 rounded-xl border border-[#E5D8C7] bg-white px-2.5 py-1 text-xs font-medium text-text transition hover:border-primary/35 hover:text-primary dark:border-darkBorder dark:bg-[#242424] dark:text-[#F5F0EA]"
                    >
                      {t(action.key)}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {thinking ? (
            <div className="max-w-[86%] rounded-2xl bg-beige/70 p-4 text-sm leading-6 text-muted dark:bg-[#24211F] dark:text-darkMuted">
              {t("assistant.thinking")}
            </div>
          ) : null}
        </div>
        <div className="border-t border-[#E8DECF] p-4 dark:border-darkBorder">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={toggleListening}
              disabled={!speechSupported}
              aria-pressed={isListening}
              aria-label={t("capture.microphone")}
              title={speechSupported ? t("capture.microphone") : t("capture.micUnsupported")}
              className={cn(
                "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white transition",
                isListening ? "animate-pulse bg-danger" : "bg-primary hover:bg-primaryDark dark:bg-darkPrimary",
                !speechSupported && "cursor-not-allowed opacity-55"
              )}
            >
              <Mic size={18} />
            </button>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void sendMessage();
                }
              }}
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#E5D8C7] bg-white px-4 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
              placeholder={t("aiAssistant.placeholder")}
            />
            <Button onClick={() => void sendMessage()} disabled={thinking}>
              <MessageSquareText size={16} />
              {t("actions.send")}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function CapturePage() {
  const { data, t, analyzeAndCommitInput, language } = useAppState();
  const [transcript, setTranscript] = useState("");
  const [analysis, setAnalysis] = useState<AiCaptureAnalysis | null>(null);
  const [created, setCreated] = useState<AiCaptureResponse["created"] | null>(null);
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [captureErrorKey, setCaptureErrorKey] = useState<string | null>(null);
  const [captureErrorMessage, setCaptureErrorMessage] = useState<string | null>(null);
  const [companyResolution, setCompanyResolution] = useState<AiCaptureResponse["companyResolution"] | null>(null);
  const [addressResolutions, setAddressResolutions] = useState<Array<{ detectedName: string; message: string }>>([]);
  const [draftCompanies, setDraftCompanies] = useState<DraftCompanyResolution[]>([]);
  const [resolvedDrafts, setResolvedDrafts] = useState<AiCompanyDraftRequest[]>([]);
  const [sourceType, setSourceType] = useState<"voice" | "text">("text");
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [micStatusKey, setMicStatusKey] = useState("capture.micReady");
  const [locationState, setLocationState] = useState<BrowserLocationState>(defaultBrowserLocationState);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const rankedCandidates = companyResolution ? rankResolutionCandidates(companyResolution.candidates, locationState.coordinates) : [];
  const recommendedCandidate = rankedCandidates[0] ?? null;
  const alternativeCandidates = rankedCandidates.slice(1);
  const displayedCandidates = recommendedCandidate ? alternativeCandidates : rankedCandidates;
  const createdCompany = createdCompanyId ? data.companies.find((company) => company.id === createdCompanyId) ?? null : null;
  const currentAddressResolution = addressResolutions[0] ?? null;
  const currentDraftCompany = currentAddressResolution
    ? draftCompanies.find((draft) => draft.detectedName === currentAddressResolution.detectedName) ?? null
    : null;

  useEffect(() => {
    let cancelled = false;

    void requestBrowserLocation().then((nextState) => {
      if (!cancelled) {
        setLocationState(nextState);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  function stopListening() {
    // Automatically halt the microphone when analysis starts/finishes so the
    // recording ends the moment the user hands the transcript to the AI.
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    recognitionRef.current = null;
    setIsListening(false);
    setMicStatusKey("capture.micReady");
  }

  async function analyze() {
    const sourceText = transcript.trim();
    if (!sourceText) {
      setCaptureErrorKey("capture.emptyTranscript");
      setCaptureErrorMessage(null);
      return;
    }

    stopListening();
    setAnalyzing(true);
    setCaptureErrorKey(null);
    setCaptureErrorMessage(null);
    setCreatedCompanyId(null);
    setCreated(null);
    setCompanyResolution(null);
    setAddressResolutions([]);
    setDraftCompanies([]);
    setResolvedDrafts([]);
    try {
      const result = await analyzeAndCommitInput(sourceText, sourceType);
      const nextAddressResolutions = normalizeAddressResolutions(result);
      setAnalysis(result.analysis);
      setCreated(result.created);
      setCreatedCompanyId(result.created.companyId);
      setCompanyResolution(result.companyResolution ?? null);
      setAddressResolutions(nextAddressResolutions);
      setDraftCompanies(buildDraftCompanies(nextAddressResolutions));
    } catch (error) {
      setCaptureErrorKey(null);
      setCaptureErrorMessage(error instanceof Error && error.message ? error.message : t("capture.aiError"));
    } finally {
      setAnalyzing(false);
    }
  }

  async function resolveCompanyConflict(selection: { existingCompanyId?: string | null; createSeparateCompany?: boolean }) {
    const sourceText = transcript.trim();
    if (!sourceText) {
      setCaptureErrorKey("capture.emptyTranscript");
      setCaptureErrorMessage(null);
      return;
    }

    setAnalyzing(true);
    setCaptureErrorKey(null);
    setCaptureErrorMessage(null);
    try {
      const result = await analyzeAndCommitInput(sourceText, sourceType, selection);
      const nextAddressResolutions = normalizeAddressResolutions(result);
      setAnalysis(result.analysis);
      setCreated(result.created);
      setCreatedCompanyId(result.created.companyId);
      setCompanyResolution(result.companyResolution ?? null);
      setAddressResolutions(nextAddressResolutions);
      setDraftCompanies(buildDraftCompanies(nextAddressResolutions));
      setResolvedDrafts([]);
    } catch (error) {
      setCaptureErrorMessage(error instanceof Error && error.message ? error.message : t("capture.aiError"));
    } finally {
      setAnalyzing(false);
    }
  }

  async function submitAddressResolution() {
    const sourceText = transcript.trim();
    if (!sourceText) {
      setCaptureErrorKey("capture.emptyTranscript");
      setCaptureErrorMessage(null);
      return;
    }

    if (!currentDraftCompany) {
      setCaptureErrorMessage("Firma adres cözümlemesi için aktif bir kart bulunamadi.");
      return;
    }

    if (!currentDraftCompany.name.trim() || !currentDraftCompany.address.trim()) {
      setCaptureErrorMessage(`"${currentDraftCompany.detectedName}" icin firma adi ve adres gerekli.`);
      return;
    }

    setAnalyzing(true);
    setCaptureErrorKey(null);
    setCaptureErrorMessage(null);
    try {
      const currentDraftPayload: AiCompanyDraftRequest = {
        detectedName: currentDraftCompany.detectedName,
        name: currentDraftCompany.name.trim(),
        address: currentDraftCompany.address.trim(),
        phone: currentDraftCompany.phone.trim() || null,
        email: currentDraftCompany.email.trim() || null,
        contactPerson: currentDraftCompany.contactPerson.trim() || null
      };
      const normalizeDraftKey = (value?: string | null) => (value ?? "").trim().toLowerCase();
      const currentKey = normalizeDraftKey(currentDraftPayload.detectedName);
      const mergedDrafts: AiCompanyDraftRequest[] = [
        ...resolvedDrafts.filter((item) => normalizeDraftKey(item.detectedName) !== currentKey),
        currentDraftPayload
      ];

      const result = await analyzeAndCommitInput(
        sourceText,
        sourceType,
        { createSeparateCompany: true },
        mergedDrafts
      );
      const nextAddressResolutions = normalizeAddressResolutions(result);
      setAnalysis(result.analysis);
      setCreated(result.created);
      setCreatedCompanyId(result.created.companyId);
      setCompanyResolution(result.companyResolution ?? null);
      setAddressResolutions(nextAddressResolutions);
      setDraftCompanies(buildDraftCompanies(nextAddressResolutions));
      setResolvedDrafts(nextAddressResolutions.length > 0 ? mergedDrafts : []);
    } catch (error) {
      setCaptureErrorMessage(error instanceof Error && error.message ? error.message : t("capture.aiError"));
    } finally {
      setAnalyzing(false);
    }
  }

  function toggleListening() {
    if (isListening) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);
      setMicStatusKey("capture.micReady");
      return;
    }

    const SpeechRecognitionConstructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionConstructor) {
      setSpeechSupported(false);
      setMicStatusKey("capture.micUnsupported");
      return;
    }

    const recognition = new SpeechRecognitionConstructor();
    const initialTranscript = transcript.trim() ? `${transcript.trim()}\n` : "";
    let committedTranscript = initialTranscript;
    let hadError = false;

    recognition.lang = getLanguageMeta(language).locale;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += text;
        } else {
          interimText += text;
        }
      }

      if (finalText) {
        committedTranscript = `${committedTranscript}${finalText} `;
        setSourceType("voice");
      }
      setTranscript(`${committedTranscript}${interimText}`.trimStart());
    };
    recognition.onerror = (event) => {
      hadError = true;
      setIsListening(false);
      setMicStatusKey(event.error === "no-speech" ? "capture.micNoSpeech" : "capture.micError");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      if (!hadError) {
        setMicStatusKey("capture.micReady");
      }
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    setMicStatusKey("capture.micListening");
    recognition.start();
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("capture.title")} subtitle={t("capture.subtitle")} />
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <div className="flex flex-col items-center text-center">
            <button
              type="button"
              onClick={toggleListening}
              disabled={!speechSupported}
              aria-pressed={isListening}
              className={cn(
                "mb-5 flex h-28 w-28 items-center justify-center rounded-full text-white shadow-premium transition",
                isListening
                  ? "animate-pulse bg-danger ring-8 ring-danger/15"
                  : "bg-primary hover:bg-primaryDark dark:bg-darkPrimary",
                !speechSupported && "cursor-not-allowed opacity-55"
              )}
              aria-label={t("capture.microphone")}
            >
              <Mic size={38} />
            </button>
            <h2 className="text-lg font-semibold text-text dark:text-[#F5F0EA]">
              {isListening ? t("capture.micListeningTitle") : t("capture.microphone")}
            </h2>
            <p className="mt-2 text-sm text-muted dark:text-darkMuted">{t(micStatusKey)}</p>
          </div>
          <label className="mt-6 block text-sm font-medium text-text dark:text-[#F5F0EA]">{t("capture.transcript")}</label>
          <textarea
            value={transcript}
            onChange={(event) => {
              setTranscript(event.target.value);
              setSourceType("text");
            }}
            className="mt-2 min-h-44 w-full rounded-2xl border border-[#E5D8C7] bg-[#FFFDF9] p-4 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
            placeholder={t("capture.transcriptPlaceholder")}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant={isListening ? "secondary" : "ghost"} onClick={toggleListening} disabled={!speechSupported}>
              <Mic size={16} />
              {isListening ? t("actions.stopRecording") : t("actions.startRecording")}
            </Button>
            <Button onClick={analyze} disabled={analyzing}>
              <Sparkles size={16} />
              {analyzing ? t("capture.analyzing") : t("actions.analyze")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                recognitionRef.current?.stop();
                setTranscript("");
                setAnalysis(null);
                setCreated(null);
                setCreatedCompanyId(null);
                setCaptureErrorKey(null);
                setCaptureErrorMessage(null);
                setCompanyResolution(null);
                setAddressResolutions([]);
                setDraftCompanies([]);
                setResolvedDrafts([]);
                setSourceType("text");
              }}
            >
              {t("actions.clear")}
            </Button>
          </div>
        </Card>

        <Card>
          <SectionTitle title={t("capture.parsedPreview")} icon={Bot} />
          {captureErrorMessage ? (
            <div className="mb-3 rounded-2xl border border-danger/25 bg-danger/10 p-4 text-sm text-danger dark:text-[#FCA5A5]">
              {captureErrorMessage}
            </div>
          ) : null}
          {captureErrorKey ? (
            <div className="mb-3 rounded-2xl border border-danger/25 bg-danger/10 p-4 text-sm text-danger dark:text-[#FCA5A5]">
              {t(captureErrorKey)}
            </div>
          ) : null}
          {companyResolution ? (
            <div className="mb-3 rounded-2xl border border-warning/25 bg-warning/5 p-4 dark:border-warning/20 dark:bg-warning/10">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
                  <Building2 size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-text dark:text-[#F5F0EA]">Firma kaydı netleştirme gerekli</h3>
                  <p className="mt-1 text-sm leading-6 text-muted dark:text-darkMuted">{companyResolution.message}</p>
                  {locationState.message ? (
                    <div className="mt-3 rounded-2xl border border-[#E8DECF] bg-white/80 p-3 text-sm text-muted dark:border-darkBorder dark:bg-[#202020] dark:text-darkMuted">
                      {locationState.message}
                    </div>
                  ) : null}
                  {recommendedCandidate ? (
                    <div className="mt-4 rounded-2xl border border-primary/30 bg-white p-4 dark:border-darkPrimary/30 dark:bg-[#202020]">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary dark:text-darkPrimary">AI onerisi</p>
                        <Badge tone="primary">Onerilen en yakin sube</Badge>
                        {recommendedCandidate.distanceMeters ? <Badge>{formatDistanceLabel(recommendedCandidate.distanceMeters)}</Badge> : null}
                      </div>
                      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold text-text dark:text-[#F5F0EA]">{recommendedCandidate.name}</p>
                          <p className="mt-1 text-sm text-muted dark:text-darkMuted">
                            {recommendedCandidate.address || "Adres eklenmemis"} · {formatNumber(recommendedCandidate.taskCount, language)} gorev
                          </p>
                          <p className="mt-1 text-xs text-muted/80 dark:text-darkMuted/80">
                            Olusturulma: {formatDate(recommendedCandidate.createdAt, language)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            disabled={analyzing}
                            onClick={() => void resolveCompanyConflict({ existingCompanyId: recommendedCandidate.id })}
                          >
                            Mevcut firmaya bagla
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={!hasRouteDestination(recommendedCandidate)}
                            onClick={() => openCompanyRoute(recommendedCandidate, locationState.coordinates)}
                          >
                            {t("actions.openInGoogleMaps")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-4 space-y-3">
                    {displayedCandidates.map((candidate) => (
                      <div key={candidate.id} className="rounded-2xl border border-[#E8DECF] bg-white p-4 dark:border-darkBorder dark:bg-[#202020]">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-text dark:text-[#F5F0EA]">{candidate.name}</p>
                              {candidate.distanceMeters ? <Badge>{formatDistanceLabel(candidate.distanceMeters)}</Badge> : null}
                            </div>
                            <p className="mt-1 text-sm text-muted dark:text-darkMuted">
                              {candidate.address || "Adres eklenmemiş"} · {formatNumber(candidate.taskCount, language)} görev
                            </p>
                            <p className="mt-1 text-xs text-muted/80 dark:text-darkMuted/80">
                              Oluşturulma: {formatDate(candidate.createdAt, language)}
                            </p>
                          </div>
                          <Button
                            variant="secondary"
                            disabled={analyzing}
                            onClick={() => void resolveCompanyConflict({ existingCompanyId: candidate.id })}
                          >
                            Mevcut firmaya bağla
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button disabled={analyzing} onClick={() => void resolveCompanyConflict({ createSeparateCompany: true })}>
                      Ayrı yeni firma kaydı aç
                    </Button>
                    <Button variant="ghost" disabled={analyzing} onClick={() => setCompanyResolution(null)}>
                      Şimdilik karar verme
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {currentAddressResolution && currentDraftCompany ? (
            <div className="mb-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 dark:border-darkPrimary/25 dark:bg-darkPrimary/10">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary dark:text-darkPrimary">
                  <MapPin size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-text dark:text-[#F5F0EA]">Yeni firma adresi gerekli</h3>
                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl border border-primary/15 bg-white/70 p-4 dark:border-darkPrimary/20 dark:bg-[#1F1F1F]">
                      <p className="text-sm leading-6 text-muted dark:text-darkMuted">
                        {currentAddressResolution.message ?? `${currentDraftCompany.detectedName} icin adres bilgisi gerekli.`}
                      </p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label className="block sm:col-span-2">
                          <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">Firma adi</span>
                          <input
                            value={currentDraftCompany.name}
                            onChange={(event) =>
                              setDraftCompanies((current) =>
                                current.map((item) => item.detectedName === currentDraftCompany.detectedName ? { ...item, name: event.target.value } : item)
                              )
                            }
                            className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                          />
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">Adres</span>
                          <textarea
                            value={currentDraftCompany.address}
                            onChange={(event) =>
                              setDraftCompanies((current) =>
                                current.map((item) => item.detectedName === currentDraftCompany.detectedName ? { ...item, address: event.target.value } : item)
                              )
                            }
                            className="mt-2 min-h-28 w-full rounded-xl border border-[#E5D8C7] bg-white p-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                            placeholder="Sube adresini buraya girin"
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">Telefon</span>
                          <input
                            value={currentDraftCompany.phone}
                            onChange={(event) =>
                              setDraftCompanies((current) =>
                                current.map((item) => item.detectedName === currentDraftCompany.detectedName ? { ...item, phone: event.target.value } : item)
                              )
                            }
                            className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">Ilgili kisi</span>
                          <input
                            value={currentDraftCompany.contactPerson}
                            onChange={(event) =>
                              setDraftCompanies((current) =>
                                current.map((item) => item.detectedName === currentDraftCompany.detectedName ? { ...item, contactPerson: event.target.value } : item)
                              )
                            }
                            className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                          />
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">E-posta</span>
                          <input
                            value={currentDraftCompany.email}
                            onChange={(event) =>
                              setDraftCompanies((current) =>
                                current.map((item) => item.detectedName === currentDraftCompany.detectedName ? { ...item, email: event.target.value } : item)
                              )
                            }
                            className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button disabled={analyzing} onClick={() => void submitAddressResolution()}>
                      {addressResolutions.length > 1 ? "Siradaki firmayi kaydet" : "Firma kaydini olustur"}
                    </Button>
                    <Button variant="ghost" disabled={analyzing} onClick={() => { setAddressResolutions([]); setDraftCompanies([]); setResolvedDrafts([]); }}>
                      Vazgec
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {analysis ? (
            <div className="space-y-3">
              <ParsedRow label={t("common.detectedLanguage")} value={analysis.detectedLanguage.toUpperCase()} />
              <ParsedRow label={t("capture.detectedCompany")} value={getCaptureAnalysisCompanyLabel(analysis)} confidence={analysis.company.confidence} />
              <ParsedRow label={t("capture.detectedModules")} value={analysis.modules.map((module) => module.name).join(", ")} />
              <ParsedRow label={t("capture.detectedTasks")} value={analysis.tasks.map((task) => task.title).join(" · ")} />
              <ParsedRow
                label={t("capture.detectedOfferPrices")}
                value={
                  analysis.offerData.detected
                    ? [...analysis.offerData.products, ...analysis.offerData.prices.map((price) => `${price} ${analysis.offerData.currency}`)].join(", ")
                    : "-"
                }
              />
              <div className="rounded-2xl border border-[#E8DECF] bg-white p-4 dark:border-darkBorder dark:bg-[#202020]">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm text-muted dark:text-darkMuted">{t("capture.detectedDateTime")}</span>
                  <Badge tone="neutral">{created?.taskIds.length ?? analysis.tasks.length}</Badge>
                </div>
                <div className="mt-3 space-y-3">
                  {analysis.tasks.map((task, index) => {
                    const isPersonal = inferCaptureTaskScope(task, analysis);
                    const taskDateTime = [formatShortDate(task.dueDate ?? null, language), task.dueTime ?? task.timeWindow ?? "-"].filter(Boolean).join(" ");
                    const taskModules = getCaptureTaskModuleNames(task, analysis, language);
                    return (
                      <div
                        key={`${task.title}-${index}`}
                        className="rounded-2xl border border-[#EFE4D3] bg-[#FFFDF9] p-4 dark:border-darkBorder dark:bg-[#242424]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-text dark:text-[#F5F0EA]">{task.title}</span>
                          <Badge tone={isPersonal ? "warning" : "neutral"}>
                            {isPersonal ? getPersonalScopeLabel(language) : getCaptureTaskCompanyLabel(task, analysis) ?? "-"}
                          </Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {taskModules.map((moduleName) => (
                            <Badge key={`${task.title}-${moduleName}`} tone="neutral">
                              {moduleName}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="text-xs uppercase tracking-[0.16em] text-muted dark:text-darkMuted">{t("capture.detectedDateTime")}</p>
                            <p className="mt-1 text-sm font-medium text-text dark:text-[#F5F0EA]">{taskDateTime}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.16em] text-muted dark:text-darkMuted">{t("capture.detectedReminder")}</p>
                            <p className="mt-1 text-sm font-medium text-text dark:text-[#F5F0EA]">{task.reminderRule ?? "-"}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-2xl bg-beige/65 p-4 text-sm text-muted dark:bg-[#24211F] dark:text-darkMuted">
                {companyResolution ? "AI analizi tamamlandı. Aynı isimli firma kaydı bulunduğu için kayıt oluşturmadan önce kararınızı bekliyoruz." : t("capture.autoCreated")}
              </div>
              {created && !companyResolution ? (
                <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm text-success dark:text-[#80D9B0]">
                  <div>{t("capture.created")}</div>
                  <div className="mt-1 font-semibold">{formatNumber(created.taskIds.length, language)} {t("capture.detectedTasks")}</div>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {createdCompanyId ? (
                      <Link href={`/companies/${createdCompanyId}`} className="inline-flex font-semibold underline">
                        {t("actions.openCompany")}
                      </Link>
                    ) : null}
                    {createdCompany ? (
                      <button
                        type="button"
                        className="inline-flex font-semibold underline"
                        onClick={() => openCompanyRoute(createdCompany, locationState.coordinates)}
                      >
                        {t("actions.openInGoogleMaps")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState title={t("capture.parsedPreview")} />
          )}
        </Card>
      </div>
    </div>
  );
}

export function OffersPage() {
  const { data, t, language, offerFromUrl } = useAppState();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "all";
  const [previewOffer, setPreviewOffer] = useState<Offer | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [fromUrlOpen, setFromUrlOpen] = useState(false);
  const [fromUrlValue, setFromUrlValue] = useState("");
  const [fromUrlCompanyId, setFromUrlCompanyId] = useState("");
  const [fromUrlBusy, setFromUrlBusy] = useState(false);
  const [fromUrlError, setFromUrlError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const filteredOffers = data.offers.filter((item) => {
    if (view === "pending") return ["prepared", "sent", "followUpNeeded"].includes(item.status);
    if (view === "lost") return item.status === "rejected";
    return true;
  });
  const selectedOffer = selectedOfferId ? data.offers.find((item) => item.id === selectedOfferId) ?? null : null;
  const offer = selectedOffer ?? filteredOffers[0] ?? data.offers[0] ?? null;

  async function downloadOfferPdf() {
    if (!offer || downloading) return;
    setDownloading(true);
    try {
      await downloadPdf(`/offers/${offer.id}/pdf`, `${offer.offerNumber || "offer"}.pdf`);
    } catch {
      // download failed silently — API may be offline
    } finally {
      setDownloading(false);
    }
  }

  async function submitOfferFromUrl(event: React.FormEvent) {
    event.preventDefault();
    const url = fromUrlValue.trim();
    if (!url || fromUrlBusy) return;
    setFromUrlBusy(true);
    setFromUrlError(null);
    try {
      const result = await offerFromUrl({ url, companyId: fromUrlCompanyId || null });
      setSelectedOfferId(result.offer.id);
      setFromUrlOpen(false);
      setFromUrlValue("");
      setFromUrlCompanyId("");
    } catch (error) {
      setFromUrlError(error instanceof Error ? error.message : t("offers.fromUrlError"));
    } finally {
      setFromUrlBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("offers.title")}
        subtitle={t("offers.subtitle")}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { setFromUrlOpen(true); setFromUrlError(null); }}>
              <Link2 size={16} />
              {t("actions.offerFromUrl")}
            </Button>
            <Button variant="secondary" disabled={!offer || downloading} onClick={() => void downloadOfferPdf()}>
              <Download size={16} />
              {t("actions.downloadPdf")}
            </Button>
            <Button disabled={!offer} onClick={() => offer && setPreviewOffer(offer)}>
              <FileText size={16} />
              {t("actions.generatePdf")}
            </Button>
          </div>
        }
      />
      <RecordManager />
      {!filteredOffers.length ? <EmptyState title={t("empty.noTasks")} /> : null}
      {offer && view !== "lost" ? (
      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <SectionTitle title={t("actions.createOffer")} subtitle={t("offers.followUpRule")} icon={FileText} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("offers.offerNumber")} value={offer.offerNumber} />
            <Field label={t("offers.offerDate")} value={formatDate(offer.offerDate, language)} />
            <Field label={t("common.company")} value={getCompanyById(data, offer.companyId)?.name ?? ""} />
            <Field label={t("offers.offerTitle")} value={offer.title} />
            <Field label={t("offers.validity")} value={`${offer.validityDays} ${t("common.date")}`} />
            <Field label={t("offers.paymentTerms")} value="14 Tage netto / 14 days net" />
          </div>
          <ItemTable items={offer.items} currency={offer.currency} />
          <Totals subtotal={offer.subtotal} vat={offer.vatAmount} total={offer.total} currency={offer.currency} />
        </Card>
        <div className="space-y-5">
          {view !== "pending" ? <Card>
            <SectionTitle title={t("offers.packageOptions")} icon={Package} />
            <div className="space-y-3">
              {[
                [t("offers.economy"), 890, "QR Menu + basic layout"],
                [t("offers.standard"), 1350, "65 inch display + setup"],
                [t("offers.premium"), 5503.68, "LED wall + installation"]
              ].map(([label, price, description]) => (
                <button key={String(label)} className="w-full rounded-2xl border border-[#E8DECF] bg-white p-4 text-start transition hover:border-primary/35 dark:border-darkBorder dark:bg-[#202020]">
                  <span className="flex items-center justify-between gap-3">
                    <strong className="text-text dark:text-[#F5F0EA]">{label}</strong>
                    <Badge tone="primary">{formatCurrency(Number(price), language)}</Badge>
                  </span>
                  <span className="mt-2 block text-sm text-muted dark:text-darkMuted">{description}</span>
                </button>
              ))}
            </div>
          </Card> : null}
          <Card>
            <SectionTitle title={t("offers.marginView")} icon={BarChart3} />
            <div className="space-y-2 text-sm text-muted dark:text-darkMuted">
              <p>{t("products.minimumWarning")}</p>
              {data.products.slice(0, 3).map((product) => (
                <div key={product.id} className="flex justify-between gap-3 rounded-xl bg-beige/50 p-3 dark:bg-[#24211F]">
                  <span>{product.name}</span>
                  <strong className="text-text dark:text-[#F5F0EA]">{formatPercent(product.margin, language)}</strong>
                </div>
              ))}
            </div>
          </Card>
          <div className="grid gap-3">
            {filteredOffers.map((item) => (
              <OfferCard key={item.id} offer={item} />
            ))}
          </div>
        </div>
      </div>
      ) : null}
      {view === "lost" ? (
        <ListCard
          title={t("nav.lostOffers")}
          items={filteredOffers.map((item) => <OfferCard key={item.id} offer={item} />)}
        />
      ) : null}
      {previewOffer ? <PdfPreview kind="offer" offer={previewOffer} onClose={() => setPreviewOffer(null)} /> : null}
      {fromUrlOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={submitOfferFromUrl}
            className="w-full max-w-md rounded-2xl border border-[#E8DECF] bg-[#FDFBF7] p-5 shadow-2xl dark:border-darkBorder dark:bg-[#1E1E1E]"
          >
            <h3 className="text-base font-semibold text-text dark:text-[#F5F0EA]">{t("offers.fromUrlTitle")}</h3>
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">{t("offers.fromUrlSubtitle")}</p>
            {fromUrlError ? (
              <div className="mt-3 rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger dark:text-[#FCA5A5]">
                {fromUrlError}
              </div>
            ) : null}
            <label className="mt-4 block text-sm font-medium text-text dark:text-[#F5F0EA]">
              {t("offers.fromUrlLabel")}
              <input
                autoFocus
                type="url"
                required
                value={fromUrlValue}
                onChange={(event) => setFromUrlValue(event.target.value)}
                placeholder="https://..."
                className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
              />
            </label>
            <label className="mt-3 block text-sm font-medium text-text dark:text-[#F5F0EA]">
              {t("common.company")}
              <select
                value={fromUrlCompanyId}
                onChange={(event) => setFromUrlCompanyId(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
              >
                <option value="">{t("quickTask.noCompany")}</option>
                {data.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setFromUrlOpen(false)}>
                {t("actions.close")}
              </Button>
              <Button type="submit" disabled={fromUrlBusy || !fromUrlValue.trim()}>
                <Link2 size={16} />
                {fromUrlBusy ? t("offers.fromUrlBusy") : t("actions.offerFromUrl")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function InvoicesPage() {
  const { data, t, language, markInvoicePaid, createTask } = useAppState();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "all";
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const filteredInvoices = data.invoices.filter((item) => {
    if (view === "waiting") return ["unpaid", "partiallyPaid", "overdue"].includes(item.status);
    return true;
  });
  const invoice = filteredInvoices[0] ?? data.invoices[0] ?? null;

  async function runInvoiceAction(action: () => Promise<void>, successMessage: string) {
    if (actionBusy) return;
    setActionBusy(true);
    setActionMessage(null);
    try {
      await action();
      setActionMessage(successMessage);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : t("admin.users.actionFailed"));
    } finally {
      setActionBusy(false);
    }
  }

  function markPaid() {
    if (!invoice) return;
    void runInvoiceAction(() => markInvoicePaid(invoice.id), t("invoices.markedPaid"));
  }

  function createFollowUpTask() {
    if (!invoice) return;
    void runInvoiceAction(
      () =>
        createTask({
          title: t("invoices.followUpTaskTitle", { number: invoice.invoiceNumber }),
          description: t("invoices.followUpTaskDescription", { number: invoice.invoiceNumber }),
          companyId: invoice.companyId || null,
          moduleIds: ["module-payments"],
          type: "payments",
          dueDate: isoDate(1),
          priority: "medium",
          status: "open"
        }),
      t("invoices.followUpCreated")
    );
  }

  function createPaymentReminderTask() {
    if (!invoice) return;
    void runInvoiceAction(
      () =>
        createTask({
          title: t("invoices.paymentReminderTaskTitle", { number: invoice.invoiceNumber }),
          description: t("invoices.paymentReminderTaskDescription", { number: invoice.invoiceNumber }),
          companyId: invoice.companyId || null,
          moduleIds: ["module-payments"],
          type: "payments",
          dueDate: isoDate(0),
          priority: "high",
          status: "open"
        }),
      t("invoices.paymentReminderCreated")
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("invoices.title")} subtitle={t("invoices.subtitle")} action={<Button disabled={!invoice} onClick={() => invoice && setPreviewInvoice(invoice)}><ReceiptText size={16} />{t("actions.generatePdf")}</Button>} />
      <RecordManager />
      {actionMessage ? (
        <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm text-success dark:text-[#80D9B0]">
          {actionMessage}
        </div>
      ) : null}
      {!filteredInvoices.length ? <EmptyState title={t("empty.noTasks")} /> : null}
      {invoice ? (
      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <SectionTitle title={t("actions.createInvoice")} icon={ReceiptText} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("invoices.invoiceNumber")} value={invoice.invoiceNumber} />
            <Field label={t("invoices.invoiceDate")} value={formatDate(invoice.invoiceDate, language)} />
            <Field label={t("invoices.dueDate")} value={formatDate(invoice.dueDate, language)} />
            <Field label={t("common.company")} value={getCompanyById(data, invoice.companyId)?.name ?? ""} />
            <Field label={t("invoices.paymentStatus")} value={t(getStatusKey(invoice.status))} />
            <Field label={t("common.total")} value={formatCurrency(invoice.total, language)} />
          </div>
          <ItemTable items={invoice.items} currency="EUR" />
          <Totals subtotal={invoice.subtotal} vat={invoice.total - invoice.subtotal} total={invoice.total} currency="EUR" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={actionBusy || invoice.status === "paid"} onClick={markPaid}>
              {t("actions.markAsPaid")}
            </Button>
            <Button variant="ghost" disabled={actionBusy} onClick={createPaymentReminderTask}>
              {t("actions.sendPaymentReminder")}
            </Button>
            <Button variant="ghost" disabled={actionBusy} onClick={createFollowUpTask}>
              {t("actions.createFollowUp")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void downloadPdf(`/invoices/${invoice.id}/pdf`, `${invoice.invoiceNumber || "invoice"}.pdf`).catch(() => undefined)}
            >
              <Download size={16} />
              {t("actions.downloadPdf")}
            </Button>
          </div>
        </Card>
        <Card>
          <SectionTitle title={t("invoices.paymentStatus")} icon={CreditCard} />
          <div className="space-y-3">
            {filteredInvoices.map((item) => (
              <InvoiceSummary key={item.id} invoice={item} />
            ))}
          </div>
        </Card>
      </div>
      ) : null}
      {previewInvoice ? <PdfPreview kind="invoice" invoice={previewInvoice} onClose={() => setPreviewInvoice(null)} /> : null}
    </div>
  );
}

export function ProductsPage() {
  const { data, t, language } = useAppState();
  const categories = Array.from(new Set(data.products.map((product) => product.category)));

  return (
    <div className="space-y-6">
      <PageHeader title={t("products.title")} subtitle={t("products.subtitle")} />
      <RecordManager />
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <Badge key={category}>{category}</Badge>
        ))}
      </div>
      <Card className="overflow-hidden p-0">
        <div className="premium-scroll overflow-x-auto">
          <table className="w-full min-w-[820px] text-start text-sm">
            <thead className="bg-beige/60 text-muted dark:bg-[#24211F] dark:text-darkMuted">
              <tr>
                {[t("products.name"), t("products.category"), t("products.costPrice"), t("products.sellingPrice"), t("products.minimumPrice"), t("products.margin"), t("products.lastUpdated")].map((header) => (
                  <th key={header} className="px-4 py-3 text-start font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFE4D3] dark:divide-darkBorder">
              {data.products.map((product) => (
                <tr key={product.id}>
                  <td className="px-4 py-4">
                    <strong className="block text-text dark:text-[#F5F0EA]">{product.name}</strong>
                    <span className="text-muted dark:text-darkMuted">{product.description}</span>
                  </td>
                  <td className="px-4 py-4">{product.category}</td>
                  <td className="px-4 py-4">{formatCurrency(product.costPrice, language, product.currency)}</td>
                  <td className="px-4 py-4">{formatCurrency(product.sellingPrice, language, product.currency)}</td>
                  <td className="px-4 py-4">{formatCurrency(product.minimumPrice, language, product.currency)}</td>
                  <td className="px-4 py-4">{formatPercent(product.margin, language)}</td>
                  <td className="px-4 py-4">{formatDate(product.updatedAt, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const DOCUMENT_SCAN_TYPES = ["PDF", "Photo", "Contract", "Measurement", "Price list", "Invoice", "Offer"];

export function DocumentsPage() {
  const { data, t, scanDocument } = useAppState();
  const searchParams = useSearchParams();
  const type = searchParams.get("type");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [scanCompanyId, setScanCompanyId] = useState("");
  const [scanDocumentType, setScanDocumentType] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<DocumentScanResponse | null>(null);
  const filteredDocuments = data.documents.filter((document) => {
    if (!type) return true;
    const docType = document.documentType.toLowerCase();
    const fileType = document.fileType.toLowerCase();
    const fileName = document.fileName.toLowerCase();
    if (type === "pdf") return docType.includes("pdf") || fileType.includes("pdf") || fileName.endsWith(".pdf");
    if (type === "photo") return docType.includes("photo") || fileType.startsWith("image/");
    if (type === "contract") return docType.includes("contract");
    if (type === "measurement") return docType.includes("measurement");
    if (type === "price-list") return docType.includes("price") || fileName.includes("price");
    return true;
  });

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || scanning) return;
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      const result = await scanDocument(file, {
        companyId: scanCompanyId || null,
        documentType: scanDocumentType || null
      });
      setScanResult(result);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : t("documents.scanError"));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("documents.title")}
        subtitle={t("documents.subtitle")}
        action={
          <Button disabled={scanning} onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} />
            {scanning ? t("documents.scanning") : t("actions.uploadDocument")}
          </Button>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(event) => void handleFileSelected(event)}
      />
      <RecordManager />
      <Card>
        <SectionTitle title={t("documents.uploadFlow")} subtitle={t("documents.scanHint")} icon={Upload} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <label className="block">
            <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("common.company")}</span>
            <select
              value={scanCompanyId}
              onChange={(event) => setScanCompanyId(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
            >
              <option value="">{t("quickTask.noCompany")}</option>
              {data.companies.map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("documents.documentType")}</span>
            <select
              value={scanDocumentType}
              onChange={(event) => setScanDocumentType(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
            >
              <option value="">-</option>
              {DOCUMENT_SCAN_TYPES.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button disabled={scanning} onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} />
              {scanning ? t("documents.scanning") : t("documents.scan")}
            </Button>
          </div>
        </div>
        {scanError ? (
          <div className="mt-4 rounded-2xl border border-danger/25 bg-danger/10 p-4 text-sm text-danger dark:text-[#FCA5A5]">
            {scanError}
          </div>
        ) : null}
      </Card>
      {scanResult ? (
        <Card>
          <SectionTitle
            title={t("documents.scanResult")}
            subtitle={scanResult.document.fileName}
            icon={FileText}
          />
          {!scanResult.ocrAvailable ? (
            <div className="mb-4 rounded-2xl border border-warning/25 bg-warning/10 p-4 text-sm text-warning dark:text-[#F4C36F]">
              {t("documents.ocrUnavailable")}
            </div>
          ) : null}
          {scanResult.document.summary ? (
            <div className="rounded-2xl bg-beige/55 p-4 dark:bg-[#24211F]">
              <p className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("documents.summary")}</p>
              <p className="mt-2 text-sm leading-6 text-muted dark:text-darkMuted">{scanResult.document.summary}</p>
            </div>
          ) : null}
          {scanResult.document.extractedText ? (
            <div className="mt-4 rounded-2xl border border-[#E8DECF] bg-white p-4 dark:border-darkBorder dark:bg-[#202020]">
              <p className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("documents.extractedText")}</p>
              <p className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-muted dark:text-darkMuted">
                {scanResult.document.extractedText}
              </p>
            </div>
          ) : null}
          {scanResult.fields.length ? (
            <div className="premium-scroll mt-4 overflow-x-auto rounded-2xl border border-[#E8DECF] dark:border-darkBorder">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-beige/60 text-muted dark:bg-[#24211F] dark:text-darkMuted">
                  <tr>
                    {[t("documents.fieldLabel"), t("documents.fieldValue"), t("documents.suggestedValue")].map((header) => (
                      <th key={header} className="px-4 py-3 text-start font-medium">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE4D3] dark:divide-darkBorder">
                  {scanResult.fields.map((field, index) => (
                    <tr key={`${field.key ?? field.label}-${index}`}>
                      <td className="px-4 py-3 font-medium text-text dark:text-[#F5F0EA]">{field.label}</td>
                      <td className="px-4 py-3 text-muted dark:text-darkMuted">{field.value ?? "-"}</td>
                      <td className="px-4 py-3 text-muted dark:text-darkMuted">{field.suggestedValue ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {scanResult.document.fileId ? (
            <div className="mt-4">
              <Button
                variant="secondary"
                onClick={() => void downloadPdf(`/documents/${scanResult.document.id}/filled-pdf`, `${scanResult.document.fileName || "document"}-filled.pdf`).catch(() => undefined)}
              >
                <Download size={16} />
                {t("documents.filledPdf")}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredDocuments.length ? filteredDocuments.map((document) => (
          <DocumentCard key={document.id} document={document} />
        )) : <EmptyState title={t("empty.noDocuments")} />}
      </div>
    </div>
  );
}

export function CompaniesPage() {
  const { data, t, geocodeMissingCompanies } = useAppState();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "active";
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeMessage, setGeocodeMessage] = useState<string | null>(null);
  const companies = data.companies.filter((company) => {
    if (view === "archived") return ["completed", "lost"].includes(company.status);
    if (view === "lost") return company.status === "lost";
    return !["completed", "lost"].includes(company.status);
  });

  async function runGeocodeMissing() {
    if (geocoding) return;
    setGeocoding(true);
    setGeocodeMessage(null);
    try {
      const result = await geocodeMissingCompanies();
      setGeocodeMessage(t("company.geocodeResult", { checked: result.checkedCount, verified: result.verifiedCount }));
    } catch (error) {
      setGeocodeMessage(error instanceof Error ? error.message : t("admin.users.actionFailed"));
    } finally {
      setGeocoding(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("sidebar.companies")}
        subtitle={t("dashboard.followUpCompanies")}
        action={
          <Button variant="secondary" disabled={geocoding} onClick={() => void runGeocodeMissing()}>
            <MapPin size={16} />
            {geocoding ? t("company.geocodeBusy") : t("actions.verifyMissingLocations")}
          </Button>
        }
      />
      {geocodeMessage ? (
        <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm text-success dark:text-[#80D9B0]">
          {geocodeMessage}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Badge tone={view === "active" ? "primary" : "neutral"}>{t("dashboard.title")}</Badge>
        <Badge tone={view === "archived" ? "primary" : "neutral"}>{t("nav.oldCompanies")}</Badge>
        <Badge tone={view === "lost" ? "primary" : "neutral"}>{t("nav.lostOffers")}</Badge>
      </div>
      <ListCard title={t("sidebar.companies")} items={companies.map((company) => <CompanyCard key={company.id} company={company} />)} grid />
    </div>
  );
}

export function MeasurementsPage() {
  const { t, language } = useAppState();
  const [width, setWidth] = useState(420);
  const [height, setHeight] = useState(80);
  const [price, setPrice] = useState(1638);
  const squareMeters = (width / 100) * (height / 100);
  const total = squareMeters * price;

  return (
    <div className="space-y-6">
      <PageHeader title={t("measurements.title")} subtitle={t("measurements.subtitle")} />
      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <SectionTitle title={t("measurements.title")} icon={Calculator} />
          <div className="space-y-4">
            <NumberInput label={t("measurements.width")} value={width} onChange={setWidth} />
            <NumberInput label={t("measurements.height")} value={height} onChange={setHeight} />
            <NumberInput label={t("measurements.pricePerMeter")} value={price} onChange={setPrice} />
            <Button className="w-full">
              <Plus size={16} />
              {t("actions.addToOffer")}
            </Button>
          </div>
        </Card>
        <Card>
          <SectionTitle title={t("common.total")} icon={BarChart3} />
          <div className="grid gap-4 sm:grid-cols-3">
            <ResultBox label={t("measurements.squareMeters")} value={`${formatNumber(squareMeters, language, { maximumFractionDigits: 2 })} m²`} />
            <ResultBox label={t("measurements.pricePerMeter")} value={formatCurrency(price, language)} />
            <ResultBox label={t("measurements.total")} value={formatCurrency(total, language)} />
          </div>
          <div className="mt-5 rounded-2xl border border-[#E8DECF] bg-white p-5 dark:border-darkBorder dark:bg-[#202020]">
            <p className="text-xl font-semibold text-text dark:text-[#F5F0EA]">
              {width} cm x {height} cm = {formatNumber(squareMeters, language, { maximumFractionDigits: 2 })} m²
            </p>
            <p className="mt-2 text-sm text-muted dark:text-darkMuted">
              {t("measurements.pricePerMeter")} {formatCurrency(price, language)} · {t("measurements.total")} {formatCurrency(total, language)}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function CompanyPage({ companyId }: { companyId: string }) {
  const router = useRouter();
  const { data, t, language, deleteCompany, updateCompany } = useAppState();
  const [tab, setTab] = useState("overview");
  const [editorOpen, setEditorOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyContact, setCompanyContact] = useState("");
  const [savingCompany, setSavingCompany] = useState(false);
  const company = data.companies.find((item) => item.id === companyId);

  if (!company) {
    return <EmptyState title={t("empty.noCompany")} />;
  }
  const currentCompany = company;

  const companyTasks = data.tasks.filter((task) => task.companyId === currentCompany.id);
  const companyOffers = data.offers.filter((offer) => offer.companyId === currentCompany.id);
  const companyInvoices = data.invoices.filter((invoice) => invoice.companyId === currentCompany.id);
  const companyDocuments = data.documents.filter((document) => document.companyId === currentCompany.id);
  const companyNotes = data.notes.filter((note) => note.companyId === currentCompany.id);
  const companyTimeline = data.timeline.filter((entry) => entry.companyId === currentCompany.id);
  const openEditor = () => {
    setCompanyName(currentCompany.name);
    setCompanyAddress(currentCompany.address);
    setCompanyPhone(currentCompany.phone);
    setCompanyEmail(currentCompany.email);
    setCompanyContact(currentCompany.contactPerson);
    setEditorOpen(true);
  };
  async function submitCompanyUpdate(event: React.FormEvent) {
    event.preventDefault();
    if (!companyName.trim()) {
      return;
    }
    setSavingCompany(true);
    await updateCompany(currentCompany.id, {
      name: companyName.trim(),
      address: companyAddress.trim(),
      phone: companyPhone.trim(),
      email: companyEmail.trim(),
      contactPerson: companyContact.trim()
    });
    setSavingCompany(false);
    setEditorOpen(false);
  }
  async function removeCompany() {
    if (!window.confirm(`${currentCompany.name} kaydini silmek istiyor musunuz?`)) {
      return;
    }
    await deleteCompany(currentCompany.id);
    router.push("/companies");
  }
  const tabs = [
    ["overview", "company.overview"],
    ["tasks", "company.tasks"],
    ["notes", "company.notes"],
    ["offers", "company.offers"],
    ["invoices", "company.invoices"],
    ["documents", "company.documents"],
    ["photos", "company.photos"],
    ["priceHistory", "company.priceHistory"],
    ["timeline", "company.timeline"],
    ["nextStep", "company.nextStep"]
  ];

  return (
    <div className="space-y-6">
      <CompanyHeader company={company} onEdit={openEditor} onDelete={removeCompany} />
      <Card>
        <SectionTitle title={t("company.statusPipeline")} icon={ArrowRight} />
        <div className="premium-scroll flex gap-2 overflow-x-auto pb-2">
          {statusPipeline.map((status) => (
            <span
              key={status}
              className={cn(
                "shrink-0 rounded-full border px-3 py-2 text-xs font-medium",
                company.status === status
                  ? "border-primary bg-primary text-white dark:border-darkPrimary dark:bg-darkPrimary"
                  : "border-[#E5D8C7] bg-white text-muted dark:border-darkBorder dark:bg-[#202020] dark:text-darkMuted"
              )}
            >
              {t(getStatusKey(status))}
            </span>
          ))}
        </div>
      </Card>
      <div className="premium-scroll flex gap-2 overflow-x-auto">
        {tabs.map(([id, key]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition",
              tab === id
                ? "bg-primary text-white dark:bg-darkPrimary"
                : "border border-[#E5D8C7] bg-white text-muted hover:text-primary dark:border-darkBorder dark:bg-[#202020] dark:text-darkMuted"
            )}
          >
            {t(key)}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Card>
            <SectionTitle title={t("company.overview")} icon={Building2} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("company.address")} value={company.address} />
              <Field label={t("company.phone")} value={company.phone} />
              <Field label={t("company.email")} value={company.email} />
              <Field label={t("company.contactPerson")} value={company.contactPerson} />
            </div>
          </Card>
          <Card>
            <SectionTitle title={t("company.map")} icon={Map} />
            <div className="rounded-2xl bg-beige p-4 text-muted dark:bg-[#24211F] dark:text-darkMuted">
              <div className="flex min-h-36 items-center justify-center rounded-2xl border border-dashed border-primary/15 px-4 text-center">
                {company.latitude}, {company.longitude}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" disabled={!hasRouteDestination(company)} onClick={() => openCompanyRoute(company)}>
                  {t("actions.openInGoogleMaps")}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
      {tab === "tasks" ? <ListCard title={t("company.tasks")} items={companyTasks.map((task) => <TaskCard key={task.id} task={task} showRouteAction />)} /> : null}
      {tab === "notes" ? <TextList title={t("company.notes")} items={companyNotes.map((note) => note.content)} /> : null}
      {tab === "offers" ? <ListCard title={t("company.offers")} items={companyOffers.map((offer) => <OfferCard key={offer.id} offer={offer} />)} /> : null}
      {tab === "invoices" ? <ListCard title={t("company.invoices")} items={companyInvoices.map((invoice) => <InvoiceSummary key={invoice.id} invoice={invoice} />)} /> : null}
      {tab === "documents" || tab === "photos" ? <ListCard title={t(tab === "photos" ? "company.photos" : "company.documents")} grid items={companyDocuments.map((document) => <DocumentCard key={document.id} document={document} />)} /> : null}
      {tab === "priceHistory" ? (
        <Card>
          <SectionTitle title={t("company.priceHistory")} icon={Package} />
          <div className="space-y-3">
            {companyOffers.flatMap((offer) => offer.items).map((item) => (
              <div key={item.id} className="flex justify-between rounded-xl bg-beige/55 p-3 text-sm dark:bg-[#24211F]">
                <span>{item.productName}</span>
                <strong>{formatCurrency(item.unitPrice, language)}</strong>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {tab === "timeline" ? <TimelineCard entries={companyTimeline} /> : null}
      {tab === "nextStep" ? (
        <Card>
          <SectionTitle title={t("company.aiSuggestions")} icon={Sparkles} />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              "suggestion.callCustomer",
              "suggestion.sendOfferFollowUp",
              "suggestion.cheaperAlternative",
              "suggestion.threePackageOffer",
              "suggestion.askMeasurement",
              "suggestion.planVisit"
            ].map((key) => (
              <button key={key} className="rounded-2xl border border-[#E8DECF] bg-white p-4 text-start text-sm font-medium text-text transition hover:border-primary/35 hover:text-primary dark:border-darkBorder dark:bg-[#202020] dark:text-[#F5F0EA]">
                {t(key)}
              </button>
            ))}
          </div>
        </Card>
      ) : null}
      {editorOpen ? (
        <CompanyEditorDialog
          companyName={companyName}
          companyAddress={companyAddress}
          companyPhone={companyPhone}
          companyEmail={companyEmail}
          companyContact={companyContact}
          onCompanyNameChange={setCompanyName}
          onCompanyAddressChange={setCompanyAddress}
          onCompanyPhoneChange={setCompanyPhone}
          onCompanyEmailChange={setCompanyEmail}
          onCompanyContactChange={setCompanyContact}
          onClose={() => setEditorOpen(false)}
          onSubmit={submitCompanyUpdate}
          saving={savingCompany}
        />
      ) : null}
    </div>
  );
}

export function ModulePage({ moduleId }: { moduleId: string }) {
  const router = useRouter();
  const { data, t, toggleModulePin, deleteModule } = useAppState();
  const [composerOpen, setComposerOpen] = useState(false);
  const resolvedModuleId = (() => {
    try {
      return decodeURIComponent(moduleId);
    } catch {
      return moduleId;
    }
  })();
  const workModule = data.modules.find((item) => item.id === resolvedModuleId || encodeURIComponent(item.id) === moduleId);

  if (!workModule) {
    return <EmptyState title={t("empty.noTasks")} />;
  }

  const activeModule = workModule;

  const tasks = data.tasks.filter((task) => {
    const rawModuleIds = task.moduleIds as unknown;
    const moduleIds = Array.isArray(rawModuleIds)
      ? rawModuleIds.map(String)
      : typeof rawModuleIds === "string"
        ? rawModuleIds.split(",").map((item: string) => item.trim()).filter(Boolean)
        : [];
    return moduleIds.includes(activeModule.id);
  });

  async function handleDeleteModule() {
    const approved = window.confirm(`${t(getModuleLabelKey(activeModule))} modulu silinsin mi?`);
    if (!approved) {
      return;
    }

    await deleteModule(activeModule.id);
    router.push("/dashboard");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t(getModuleLabelKey(activeModule))}
        subtitle={`${t("common.modules")} · ${activeModule.createdByAI ? "AI" : "Manual"}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setComposerOpen((current) => !current)}>
              <Plus size={16} />
              {t("actions.createTask")}
            </Button>
            <Button variant="secondary" onClick={() => toggleModulePin(activeModule.id)}>
              {activeModule.isPinnedToSidebar ? t("actions.unpin") : t("actions.pin")}
            </Button>
            <Button variant="danger" onClick={() => void handleDeleteModule()}>
              <Trash2 size={16} />
              Modulu sil
            </Button>
          </div>
        }
      />
      {composerOpen ? <ModuleTaskComposer module={activeModule} onClose={() => setComposerOpen(false)} /> : null}
      <Card>
        <SectionTitle title={t(getModuleLabelKey(activeModule))} icon={ClipboardList} />
        <div className="space-y-3">
          {tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task} showRouteAction />) : <EmptyState title={t("empty.noTasks")} />}
        </div>
      </Card>
    </div>
  );
}

function ModuleTaskComposer({ module, onClose }: { module: WorkModule; onClose: () => void }) {
  const { data, t, createTask } = useAppState();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;

    setBusy(true);
    await createTask({
      title: title.trim(),
      description: description.trim(),
      companyId: companyId || null,
      moduleIds: [module.id],
      type: module.type,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      priority,
      status: "open"
    });
    setBusy(false);
    onClose();
  }

  return (
    <Card>
      <SectionTitle title={t("quickTask.title")} subtitle={t(getModuleLabelKey(module))} icon={Plus} />
      <form onSubmit={submit} className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("quickTask.taskTitle")}</span>
            <input
              autoFocus
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-2 min-h-12 w-full rounded-xl border border-[#E5D8C7] bg-[#FFFDF9] px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("quickTask.description")}</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-2 min-h-32 w-full rounded-xl border border-[#E5D8C7] bg-[#FFFDF9] p-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
            />
          </label>
        </div>

        <div className="space-y-4 rounded-2xl border border-[#E8DECF] bg-[#FFFDF9] p-4 dark:border-darkBorder dark:bg-[#202020]">
          <label className="block">
            <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("common.company")}</span>
            <select
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
            >
              <option value="">{t("quickTask.noCompany")}</option>
              {data.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("quickTask.dueDate")}</span>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("quickTask.dueTime")}</span>
              <input
                type="time"
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("common.priority")}</span>
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
              className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
            >
              <option value="low">{t("priority.low")}</option>
              <option value="medium">{t("priority.medium")}</option>
              <option value="high">{t("priority.high")}</option>
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("actions.close")}
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              <Plus size={16} />
              {t("actions.createTask")}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function CompanyHeader({ company, onEdit, onDelete }: { company: Company; onEdit: () => void; onDelete: () => void }) {
  const { t, verifyCompanyAddress } = useAppState();
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  async function runVerify() {
    if (verifying) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const result = await verifyCompanyAddress(company.id);
      if (!result.verified) {
        setVerifyError(t("company.verifyFailed"));
      }
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : t("company.verifyFailed"));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-text dark:text-[#F5F0EA] sm:text-3xl">{company.name}</h1>
            <Badge tone="primary">{t(getStatusKey(company.status))}</Badge>
            {company.addressVerified ? (
              <Badge tone="success" className="gap-1" title={company.formattedAddress ?? company.address}>
                <BadgeCheck size={13} />
                {t("company.addressVerified")}
              </Badge>
            ) : (
              <Badge tone="warning">{t("company.addressNotVerified")}</Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-muted dark:text-darkMuted">
            {company.addressVerified && company.formattedAddress ? company.formattedAddress : company.address}
          </p>
          {verifyError ? <p className="mt-2 text-sm text-danger dark:text-[#FCA5A5]">{verifyError}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {company.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!company.addressVerified ? (
            <Button variant="secondary" disabled={verifying} onClick={() => void runVerify()}>
              <BadgeCheck size={16} />
              {verifying ? t("company.verifying") : t("actions.verifyAddress")}
            </Button>
          ) : null}
          <Button variant="secondary" disabled={!hasRouteDestination(company)} onClick={() => openCompanyRoute(company)}>
            <Map size={16} />
            {t("actions.openInGoogleMaps")}
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            <Plus size={16} />
            Firma duzenle
          </Button>
          <Button variant="secondary"><Phone size={16} />{t("actions.call")}</Button>
          <Button variant="secondary"><MessageSquareText size={16} />{t("actions.whatsapp")}</Button>
          <Button variant="secondary"><FileText size={16} />{t("actions.createOffer")}</Button>
          <Button variant="ghost"><Plus size={16} />{t("actions.addNote")}</Button>
          <Button variant="danger" onClick={onDelete}>
            <Trash2 size={16} />
            Firmayi sil
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CompanyEditorDialog({
  companyName,
  companyAddress,
  companyPhone,
  companyEmail,
  companyContact,
  onCompanyNameChange,
  onCompanyAddressChange,
  onCompanyPhoneChange,
  onCompanyEmailChange,
  onCompanyContactChange,
  onClose,
  onSubmit,
  saving
}: {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyContact: string;
  onCompanyNameChange: (value: string) => void;
  onCompanyAddressChange: (value: string) => void;
  onCompanyPhoneChange: (value: string) => void;
  onCompanyEmailChange: (value: string) => void;
  onCompanyContactChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  saving: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <form onSubmit={onSubmit} className="w-full max-w-2xl rounded-3xl border border-[#E8DECF] bg-[#FDFBF7] p-5 shadow-2xl dark:border-darkBorder dark:bg-[#1E1E1E]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-text dark:text-[#F5F0EA]">Firma bilgilerini guncelle</h2>
            <p className="mt-1 text-sm text-muted dark:text-darkMuted">Adres, telefon ve ilgili kisi bilgilerini dilediginiz zaman degistirebilirsiniz.</p>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>Kapat</Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">Firma adi</span>
            <input value={companyName} onChange={(event) => onCompanyNameChange(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]" />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">Adres</span>
            <textarea value={companyAddress} onChange={(event) => onCompanyAddressChange(event.target.value)} className="mt-2 min-h-28 w-full rounded-xl border border-[#E5D8C7] bg-white p-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">Telefon</span>
            <input value={companyPhone} onChange={(event) => onCompanyPhoneChange(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">Ilgili kisi</span>
            <input value={companyContact} onChange={(event) => onCompanyContactChange(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]" />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">E-posta</span>
            <input value={companyEmail} onChange={(event) => onCompanyEmailChange(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]" />
          </label>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Vazgec</Button>
          <Button type="submit" disabled={saving || !companyName.trim()}>Kaydet</Button>
        </div>
      </form>
    </div>
  );
}

function inferCaptureTaskScope(task: AiCaptureAnalysis["tasks"][number], analysis: AiCaptureAnalysis) {
  const haystack = `${task.title} ${task.description}`.toLocaleLowerCase("tr-TR");
  const personalKeywords = ["market", "markete", "alışveriş", "alisveris", "kıyma", "kiyma", "arkadaş", "arkadas", "buluş", "bulus", "randevu"];
  const businessKeywords = ["teklif", "offer", "angebot", "fatura", "invoice", "rechnung", "kurulum", "support", "destek", "rapor", "teslim", "müşteri", "musteri"];

  const hasSharedCompanyContext = analysis.tasks.length === 1 && Boolean(analysis.company.name?.trim());
  const hasCompanyContext = Boolean(task.companyName?.trim() || hasSharedCompanyContext);

  if (hasCompanyContext) {
    return false;
  }
  if (personalKeywords.some((keyword) => haystack.includes(keyword))) {
    return true;
  }
  if (task.type !== "todo" && task.type !== "custom") {
    return false;
  }
  if (businessKeywords.some((keyword) => haystack.includes(keyword))) {
    return false;
  }
  return true;
}

function getCaptureTaskCompanyLabel(task: AiCaptureAnalysis["tasks"][number], analysis: AiCaptureAnalysis) {
  const taskCompanyName = task.companyName?.trim();
  if (taskCompanyName) {
    return taskCompanyName;
  }

  if (analysis.tasks.length === 1) {
    return analysis.company.name?.trim() || null;
  }

  return null;
}

function getCaptureAnalysisCompanyLabel(analysis: AiCaptureAnalysis) {
  const uniqueTaskCompanies = [...new Set(
    analysis.tasks
      .map((task) => task.companyName?.trim())
      .filter((companyName): companyName is string => Boolean(companyName))
  )];

  if (uniqueTaskCompanies.length > 0) {
    return uniqueTaskCompanies.join(" · ");
  }

  return analysis.company.name?.trim() || "-";
}

function getPersonalScopeLabel(language: LanguageCode) {
  switch (language) {
    case "de":
      return "Persönlich";
    case "fr":
      return "Personnel";
    case "nl":
      return "Persoonlijk";
    case "ar":
      return "شخصي";
    case "tr":
      return "Kişisel";
    default:
      return "Personal";
  }
}

function getCaptureTaskModuleNames(task: AiCaptureAnalysis["tasks"][number], analysis: AiCaptureAnalysis, language: LanguageCode) {
  if (inferCaptureTaskScope(task, analysis)) {
    return [getPersonalScopeLabel(language)];
  }

  const matchingModules = analysis.modules.filter((module) => module.type === task.type || task.type === "custom" && module.type === "custom");
  if (matchingModules.length > 0) {
    return matchingModules.map((module) => module.name);
  }

  const fallbackLabels: Record<string, string> = {
    visits: "Visits",
    calls: "Calls",
    offers: "Offers",
    invoices: "Invoices",
    installation: "Installation",
    removal: "Removal",
    repair: "Repair",
    support: "Support",
    payments: "Payments",
    projects: "Projects",
    delivery: "Delivery",
    measurements: "Measurements",
    todo: language === "tr" ? "Yapılacak" : "To Do",
    custom: language === "tr" ? "Yapılacak" : "To Do"
  };

  return [fallbackLabels[task.type] ?? task.type];
}

function ParsedRow({ label, value, confidence }: { label: string; value: string; confidence?: number }) {
  const { language, t } = useAppState();
  return (
    <div className="rounded-2xl border border-[#E8DECF] bg-white p-4 dark:border-darkBorder dark:bg-[#202020]">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-muted dark:text-darkMuted">{label}</span>
        {typeof confidence === "number" ? <Badge tone={confidence >= 0.75 ? "success" : "warning"}>{t("common.confidence")} {formatPercent(confidence, language)}</Badge> : null}
      </div>
      <p className="mt-2 font-medium text-text dark:text-[#F5F0EA]">{value}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="text-sm text-muted dark:text-darkMuted">{label}</span>
      <input
        value={value}
        readOnly
        className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-[#FFFDF9] px-3 text-sm text-text outline-none dark:border-darkBorder dark:bg-[#242424] dark:text-[#F5F0EA]"
      />
    </label>
  );
}

function ItemTable({ items, currency }: { items: Offer["items"]; currency: string }) {
  const { t, language } = useAppState();
  return (
    <div className="premium-scroll mt-5 overflow-x-auto rounded-2xl border border-[#E8DECF] dark:border-darkBorder">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-beige/60 text-muted dark:bg-[#24211F] dark:text-darkMuted">
          <tr>
            {[t("common.item"), t("products.description"), t("common.quantity"), t("common.unitPrice"), t("common.total")].map((header) => (
              <th key={header} className="px-4 py-3 text-start font-medium">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#EFE4D3] dark:divide-darkBorder">
          {items.map((item) => (
            <tr key={item.id}>
              <td className="px-4 py-4 font-medium text-text dark:text-[#F5F0EA]">
                <span className="flex items-center gap-3">
                  {item.imageUrl ? (
                    <AuthImage
                      src={item.imageUrl}
                      alt={item.productName}
                      className="h-10 w-10 shrink-0 rounded-lg border border-[#E8DECF] object-cover dark:border-darkBorder"
                    />
                  ) : null}
                  <span className="min-w-0">{item.productName}</span>
                </span>
              </td>
              <td className="px-4 py-4 text-muted dark:text-darkMuted">{item.description}</td>
              <td className="px-4 py-4">{item.quantity}</td>
              <td className="px-4 py-4">{formatCurrency(item.unitPrice, language, currency)}</td>
              <td className="px-4 py-4">{formatCurrency(item.totalPrice, language, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ subtotal, vat, total, currency }: { subtotal: number; vat: number; total: number; currency: string }) {
  const { t, language } = useAppState();
  return (
    <div className="ms-auto mt-5 max-w-sm space-y-2 rounded-2xl bg-beige/55 p-4 text-sm dark:bg-[#24211F]">
      <div className="flex justify-between gap-4">
        <span className="text-muted dark:text-darkMuted">{t("common.subtotal")}</span>
        <strong>{formatCurrency(subtotal, language, currency)}</strong>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted dark:text-darkMuted">{t("common.vat")}</span>
        <strong>{formatCurrency(vat, language, currency)}</strong>
      </div>
      <div className="flex justify-between gap-4 border-t border-[#D8CBBB] pt-3 text-base dark:border-darkBorder">
        <span>{t("common.total")}</span>
        <strong className="text-primary dark:text-[#F3A4AF]">{formatCurrency(total, language, currency)}</strong>
      </div>
    </div>
  );
}

function InvoiceSummary({ invoice }: { invoice: Invoice }) {
  const { data, t, language } = useAppState();
  const company = getCompanyById(data, invoice.companyId);
  return (
    <article className="rounded-2xl border border-[#E8DECF] bg-white p-4 dark:border-darkBorder dark:bg-[#202020]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-text dark:text-[#F5F0EA]">{invoice.invoiceNumber}</h3>
          <p className="mt-1 text-sm text-muted dark:text-darkMuted">{company?.name}</p>
        </div>
        <Badge tone={invoice.status === "overdue" ? "danger" : invoice.status === "paid" ? "success" : "warning"}>
          {t(getStatusKey(invoice.status))}
        </Badge>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#EFE4D3] pt-4 text-sm dark:border-darkBorder">
        <span className="text-muted dark:text-darkMuted">{formatShortDate(invoice.dueDate, language)}</span>
        <span className="flex items-center gap-2">
          <strong>{formatCurrency(invoice.total, language)}</strong>
          <button
            type="button"
            title={t("actions.downloadPdf")}
            aria-label={t("actions.downloadPdf")}
            onClick={() => void downloadPdf(`/invoices/${invoice.id}/pdf`, `${invoice.invoiceNumber || "invoice"}.pdf`).catch(() => undefined)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5D8C7] bg-white text-muted transition hover:border-primary/35 hover:text-primary dark:border-darkBorder dark:bg-[#242424] dark:text-darkMuted"
          >
            <Download size={15} />
          </button>
        </span>
      </div>
    </article>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="text-sm text-muted dark:text-darkMuted">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
      />
    </label>
  );
}

function ResultBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-beige/55 p-4 dark:bg-[#24211F]">
      <p className="text-sm text-muted dark:text-darkMuted">{label}</p>
      <p className="mt-2 text-xl font-semibold text-text dark:text-[#F5F0EA]">{value}</p>
    </div>
  );
}

function TextList({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <SectionTitle title={title} icon={MessageSquareText} />
      <div className="space-y-3">
        {items.map((item) => (
          <p key={item} className="rounded-2xl bg-beige/55 p-4 text-sm leading-6 text-muted dark:bg-[#24211F] dark:text-darkMuted">
            {item}
          </p>
        ))}
      </div>
    </Card>
  );
}

function ListCard({ title, items, grid = false }: { title: string; items: React.ReactNode[]; grid?: boolean }) {
  const { t } = useAppState();
  return (
    <Card>
      <SectionTitle title={title} icon={ClipboardList} />
      <div className={cn(grid ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "space-y-3")}>
        {items.length ? items : <EmptyState title={t("empty.noTasks")} />}
      </div>
    </Card>
  );
}

function TimelineCard({ entries }: { entries: Array<{ id: string; title: string; description: string; date: string; type: string }> }) {
  const { t, language } = useAppState();
  return (
    <Card>
      <SectionTitle title={t("company.timeline")} icon={Clock3} />
      <div className="space-y-3">
        {entries.map((entry) => (
          <div key={entry.id} className="grid gap-3 rounded-2xl border border-[#E8DECF] bg-white p-4 dark:border-darkBorder dark:bg-[#202020] sm:grid-cols-[160px_1fr]">
            <div>
              <Badge>{entry.type}</Badge>
              <p className="mt-2 text-sm text-muted dark:text-darkMuted">{formatDate(entry.date, language)}</p>
            </div>
            <div>
              <h3 className="font-semibold text-text dark:text-[#F5F0EA]">{entry.title}</h3>
              <p className="mt-1 text-sm leading-6 text-muted dark:text-darkMuted">{entry.description}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PdfPreview({
  kind,
  offer,
  invoice,
  onClose
}: {
  kind: "offer" | "invoice";
  offer?: Offer;
  invoice?: Invoice;
  onClose: () => void;
}) {
  const { data, t, language, settings } = useAppState();
  const record = offer ?? invoice;
  const company = record ? getCompanyById(data, record.companyId) : null;
  const items = offer?.items ?? invoice?.items ?? [];
  const subtotal = offer?.subtotal ?? invoice?.subtotal ?? 0;
  const vat = offer?.vatAmount ?? (invoice ? invoice.total - invoice.subtotal : 0);
  const total = offer?.total ?? invoice?.total ?? 0;
  const number = offer?.offerNumber ?? invoice?.invoiceNumber ?? "";
  const date = offer?.offerDate ?? invoice?.invoiceDate ?? isoDate(0);
  const sellerName = settings?.companyName?.trim() || settings?.name || "Planix Studio";
  const sellerAddress = settings?.companyAddress?.trim() || "Frankfurt am Main";
  const sellerContactLine = [settings?.companyPhone, settings?.companyEmail].filter(Boolean).join(" · ");
  const sellerTaxLine = [
    settings?.companyTaxId ? `${t("settings.taxId")}: ${settings.companyTaxId}` : null,
    settings?.companyIban ? `${t("settings.iban")}: ${settings.companyIban}` : null
  ].filter(Boolean).join(" · ");
  const paymentTermsLabel = settings?.paymentTerms?.trim() || "14 Tage netto / 14 days net";
  const downloadPath = offer ? `/offers/${offer.id}/pdf` : invoice ? `/invoices/${invoice.id}/pdf` : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-[#FDFBF7] p-5 shadow-2xl dark:bg-[#1E1E1E] sm:p-7">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text dark:text-[#F5F0EA]">{t("offers.pdfPreview")}</h2>
          <div className="flex flex-wrap gap-2">
            {downloadPath ? (
              <Button
                variant="secondary"
                onClick={() => void downloadPdf(downloadPath, `${number || kind}.pdf`).catch(() => undefined)}
              >
                <Download size={16} />
                {t("actions.downloadPdf")}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>{t("actions.close")}</Button>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-6 text-text shadow-soft dark:bg-[#242424] dark:text-[#F5F0EA] sm:p-8">
          <div className="flex flex-col gap-5 border-b border-[#E8DECF] pb-6 dark:border-darkBorder sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-white dark:bg-darkPrimary">
                {t("pdf.logo")}
              </div>
              <p className="mt-3 text-sm text-muted dark:text-darkMuted">
                {sellerName}
                <br />
                {sellerAddress}
                {sellerContactLine ? (<><br />{sellerContactLine}</>) : null}
              </p>
            </div>
            <div className="text-start sm:text-end">
              <h3 className="text-2xl font-semibold">{t(kind === "offer" ? "pdf.offer" : "pdf.invoice")}</h3>
              <p className="mt-2 text-sm text-muted dark:text-darkMuted">{number}</p>
              <p className="text-sm text-muted dark:text-darkMuted">{formatDate(date, language)}</p>
            </div>
          </div>
          <div className="grid gap-5 border-b border-[#E8DECF] py-6 dark:border-darkBorder sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted dark:text-darkMuted">{t("pdf.company")}</p>
              <p className="mt-2 font-semibold">{sellerName}</p>
              <p className="text-sm text-muted dark:text-darkMuted">{sellerAddress}</p>
              {sellerTaxLine ? <p className="text-sm text-muted dark:text-darkMuted">{sellerTaxLine}</p> : null}
            </div>
            <div>
              <p className="text-sm font-medium text-muted dark:text-darkMuted">{t("pdf.customer")}</p>
              <p className="mt-2 font-semibold">{company?.name}</p>
              <p className="text-sm text-muted dark:text-darkMuted">{company?.address}</p>
              <p className="text-sm text-muted dark:text-darkMuted">{t("pdf.contactPerson")}: {company?.contactPerson}</p>
            </div>
          </div>
          <ItemTable items={items} currency="EUR" />
          <Totals subtotal={subtotal} vat={vat} total={total} currency="EUR" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-beige/55 p-4 dark:bg-[#2A2623]">
              <p className="text-sm font-medium">{t("pdf.paymentTerms")}</p>
              <p className="mt-2 text-sm text-muted dark:text-darkMuted">{paymentTermsLabel}</p>
            </div>
            <div className="rounded-2xl bg-beige/55 p-4 dark:bg-[#2A2623]">
              <p className="text-sm font-medium">{t("pdf.validUntil")}</p>
              <p className="mt-2 text-sm text-muted dark:text-darkMuted">{formatDate(isoDate(14), language)}</p>
            </div>
          </div>
          <p className="mt-8 border-t border-[#E8DECF] pt-5 text-sm text-muted dark:border-darkBorder dark:text-darkMuted">{t("pdf.footer")}</p>
        </div>
      </div>
    </div>
  );
}

function answerFromData(
  query: string,
  data: AppData,
  t: (key: string) => string,
  language: LanguageCode
) {
  const lower = query.toLowerCase();
  if (lower.includes("follow") || lower.includes("takip") || lower.includes("relance") || lower.includes("متابعة")) {
    const companies = data.companies.filter((company) => ["followUp", "waitingPayment", "offerSent"].includes(company.status));
    return `${t("dashboard.followUpCompanies")}: ${companies.map((company) => company.name).join(", ")}. ${t("weeklyAnalysis.aiSummary")}`;
  }
  if (lower.includes("payment") || lower.includes("zahlung") || lower.includes("ödeme") || lower.includes("paiement") || lower.includes("betaling")) {
    const invoices = data.invoices.filter((invoice) => invoice.status !== "paid");
    return `${t("dashboard.waitingPayments")}: ${invoices
      .map((invoice) => `${getCompanyById(data, invoice.companyId)?.name} ${invoice.invoiceNumber}`)
      .join(", ")}.`;
  }
  if (lower.includes("mara")) {
    const offer = data.offers.find((item) => getCompanyById(data, item.companyId)?.name === "Mara Market");
    return offer ? `${t("common.company")}: Mara Market. ${t("offers.offerNumber")}: ${offer.offerNumber}. ${offer.title}. ${t("common.total")}: ${formatCurrency(offer.total, language)}.` : t("aiAssistant.notFound");
  }
  if (lower.includes("65")) {
    const matches = data.offers.filter((offer) => offer.items.some((item) => item.productName.includes("65")));
    return matches.length ? matches.map((offer) => `${getCompanyById(data, offer.companyId)?.name}: ${offer.offerNumber}`).join(", ") : t("aiAssistant.notFound");
  }
  if (lower.includes("german") || lower.includes("deutsch")) {
    return t("aiAssistant.answerGerman");
  }
  if (lower.includes("turkish") || lower.includes("türkisch") || lower.includes("turk")) {
    return t("aiAssistant.answerTurkish");
  }

  return t("aiAssistant.notFound");
}
