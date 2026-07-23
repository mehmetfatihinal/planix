"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { parseBusinessInput } from "@/lib/ai";
import {
  acknowledgeTaskRequest,
  apiRequest,
  assignAdminTask,
  assistantAskRequest,
  createShoppingItemRequest,
  defaultLanguage,
  deleteShoppingItemRequest,
  denormalizePayload,
  emptyData,
  geocodeMissingCompaniesRequest,
  getReports,
  getSettings,
  habitStart as habitStartRequest,
  habitSnooze as habitSnoozeRequest,
  habitStop as habitStopRequest,
  getShoppingItems,
  getWeeklyAnalysis,
  lateNoticeDraftRequest,
  lateNoticeLogRequest,
  normalizeSnapshot,
  offerFromUrlRequest,
  requestTaskCompletion,
  routeErrandStops,
  scanDocumentRequest,
  snoozeTaskRequest,
  updateSettings as updateSettingsRequest,
  updateShoppingItemRequest,
  verifyCompanyAddressRequest,
  type AssignTaskInput,
  type DocumentScanResponse,
  type LateNoticeDraftResponse,
  type OfferFromUrlResponse,
  type ReportRecord,
  type SnoozeTaskInput,
  type WeeklyAnalysisResponse
} from "@/lib/api-client";
import { useAuth } from "@/lib/auth-state";
import { isoDate } from "@/lib/format";
import { moduleTranslationKey, moduleTypeByName } from "@/lib/mock-data";
import { getLanguageMeta, isRtl, translate } from "@/lib/i18n";
import type {
  AppData,
  AiCaptureResponse,
  AiCompanyDraftRequest,
  Company,
  DocumentRecord,
  ErrandMatch,
  Invoice,
  LanguageCode,
  ModuleType,
  Note,
  Offer,
  ParsedBusinessInput,
  Product,
  Reminder,
  ShoppingItem,
  SourceType,
  Task,
  ThemeMode,
  UserSettings,
  WorkModule
} from "@/types/business";

const LANGUAGE_STORAGE_KEY = "arx-task:language";
const THEME_STORAGE_KEY = "arx-task:theme";
const SIDEBAR_STORAGE_KEY = "arx-task:sidebar-collapsed";
const SNAPSHOT_CACHE_KEY = "arx-task:snapshot-cache";

interface AppStateContextValue {
  data: AppData;
  language: LanguageCode;
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  loadingData: boolean;
  settings: UserSettings | null;
  setLanguage: (language: LanguageCode) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleSidebar: () => void;
  toggleModulePin: (moduleId: string) => void;
  markTaskDone: (taskId: string, note?: string, photoFileId?: string | null) => Promise<void>;
  approveTask: (userId: string, taskId: string) => Promise<void>;
  rejectTask: (userId: string, taskId: string, reason?: string) => Promise<void>;
  promoteUser: (id: string) => Promise<void>;
  demoteUser: (id: string) => Promise<void>;
  snoozeTask: (taskId: string, options: SnoozeTaskInput) => Promise<void>;
  habitStart: (taskId: string, input: { startDate: string; reminderTime?: string; intervalDays?: number }) => Promise<void>;
  habitSnooze: (taskId: string, input?: { days?: number }) => Promise<{ ok: boolean; nextNudgeAt: string | null }>;
  habitStop: (taskId: string) => Promise<void>;
  acknowledgeTask: (taskId: string) => Promise<void>;
  assignTask: (input: AssignTaskInput) => Promise<void>;
  refreshSettings: () => Promise<void>;
  updateSettings: (input: Partial<UserSettings>) => Promise<void>;
  verifyCompanyAddress: (companyId: string) => Promise<{ company: Company; verified: boolean }>;
  geocodeMissingCompanies: () => Promise<{ checkedCount: number; verifiedCount: number }>;
  offerFromUrl: (input: { url: string; companyId?: string | null; title?: string | null }) => Promise<OfferFromUrlResponse>;
  scanDocument: (
    file: File,
    options?: { companyId?: string | null; documentType?: string | null }
  ) => Promise<DocumentScanResponse>;
  fetchShoppingItems: () => Promise<ShoppingItem[]>;
  createShoppingItem: (input: { name: string; category?: string | null; chain?: string | null }) => Promise<ShoppingItem | null>;
  updateShoppingItem: (id: string, input: Partial<ShoppingItem>) => Promise<ShoppingItem | null>;
  deleteShoppingItem: (id: string) => Promise<void>;
  fetchRouteErrands: (coords: Array<[number, number]>, bufferMeters?: number) => Promise<ErrandMatch[]>;
  fetchWeeklyAnalysis: (weekStart?: string) => Promise<WeeklyAnalysisResponse | null>;
  fetchReports: (kind?: "daily" | "weekly", limit?: number) => Promise<ReportRecord[]>;
  lateNoticeDraft: (input: { taskId: string; delayMinutes: number }) => Promise<LateNoticeDraftResponse | null>;
  lateNoticeLog: (input: { taskId: string; message: string; channel: string }) => Promise<void>;
  assistantAsk: (question: string) => Promise<string>;
  addTaskNote: (taskId: string, content?: string) => void;
  parseInput: (input: string) => ParsedBusinessInput;
  commitParsedInput: (parsed: ParsedBusinessInput, sourceText: string) => Promise<string | null>;
  analyzeAndCommitInput: (
    sourceText: string,
    sourceType: Extract<SourceType, "voice" | "text">,
    companyResolution?: { existingCompanyId?: string | null; createSeparateCompany?: boolean },
    companyDrafts?: AiCompanyDraftRequest[]
  ) => Promise<AiCaptureResponse>;
  refreshData: () => Promise<void>;
  createCompany: (input: Partial<Company>) => Promise<void>;
  updateCompany: (id: string, input: Partial<Company>) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;
  createTask: (input: Partial<Task>) => Promise<void>;
  updateTask: (id: string, input: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  createModule: (input: Partial<WorkModule>) => Promise<void>;
  deleteModule: (id: string) => Promise<void>;
  createNote: (input: Partial<Note>) => Promise<void>;
  createProduct: (input: Partial<Product>) => Promise<void>;
  createOffer: (input: Partial<Offer>) => Promise<void>;
  updateOffer: (id: string, input: Partial<Offer>) => Promise<void>;
  deleteOffer: (id: string) => Promise<void>;
  sendOffer: (id: string) => Promise<void>;
  acceptOffer: (id: string) => Promise<void>;
  convertOfferToInvoice: (id: string) => Promise<void>;
  createInvoice: (input: Partial<Invoice>) => Promise<void>;
  markInvoicePaid: (id: string) => Promise<void>;
  createDocument: (input: Partial<DocumentRecord>) => Promise<void>;
  createReminder: (input: Partial<Reminder>) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { token, user, loading: authLoading } = useAuth();
  const [data, setData] = useState<AppData>(emptyData);
  const [language, setLanguageState] = useState<LanguageCode>(defaultLanguage);
  const [theme, setThemeState] = useState<ThemeMode>("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [settings, setSettings] = useState<UserSettings | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const storedLanguage = readStorage<LanguageCode>(LANGUAGE_STORAGE_KEY);
    const storedTheme = readStorage<ThemeMode>(THEME_STORAGE_KEY);
    const storedSidebar = readStorage<boolean>(SIDEBAR_STORAGE_KEY);
    const cachedSnapshot = readStorage<AppData>(SNAPSHOT_CACHE_KEY);

    if (storedLanguage) setLanguageState(storedLanguage);
    if (storedTheme) setThemeState(storedTheme);
    if (typeof storedSidebar === "boolean") setSidebarCollapsed(storedSidebar);
    if (cachedSnapshot) {
      // Offline-first: render the last known snapshot instantly; the network
      // refresh replaces it as soon as it succeeds.
      try {
        setData(recalculateModuleCounts(normalizeSnapshot(cachedSnapshot)));
      } catch {
        localStorage.removeItem(SNAPSHOT_CACHE_KEY);
      }
    }
    setStorageReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const root = document.documentElement;
    const meta = getLanguageMeta(language);
    root.lang = language;
    root.dir = meta.dir;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
  }, [language, theme]);

  useEffect(() => {
    if (!storageReady) return;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify(language));
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(sidebarCollapsed));
  }, [language, sidebarCollapsed, storageReady, theme]);

  const refreshData = useCallback(async () => {
    if (!token || !user) {
      // While auth is still resolving the stored token, keep the cached
      // snapshot on screen instead of flashing an empty workspace.
      if (!authLoading) {
        setData(emptyData());
        try {
          localStorage.removeItem(SNAPSHOT_CACHE_KEY);
        } catch {
          // ignore storage errors
        }
      }
      return;
    }

    setLoadingData(true);
    try {
      const snapshot = await apiRequest<AppData>("/snapshot", {}, token);
      setData(recalculateModuleCounts(normalizeSnapshot(snapshot)));
      try {
        localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
      } catch {
        // ignore storage quota errors
      }
    } catch {
      // Network/API unavailable — keep the cached snapshot for read-only use.
    } finally {
      setLoadingData(false);
    }
  }, [authLoading, token, user]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void refreshData();
  }, [refreshData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const refreshSettings = useCallback(async () => {
    if (!token || !user) {
      setSettings(null);
      return;
    }
    try {
      setSettings(await getSettings(token));
    } catch {
      // Settings stay null when the endpoint is unreachable.
    }
  }, [token, user]);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  const updateSettings = useCallback(
    async (input: Partial<UserSettings>) => {
      if (!token) return;
      const next = await updateSettingsRequest(token, input);
      setSettings(next);
    },
    [token]
  );

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(language, key, params),
    [language]
  );

  const setLanguage = useCallback((nextLanguage: LanguageCode) => setLanguageState(nextLanguage), []);
  const setTheme = useCallback((nextTheme: ThemeMode) => setThemeState(nextTheme), []);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((current) => !current), []);

  const mutate = useCallback(
    async <T,>(path: string, method: "POST" | "PUT" | "DELETE", payload?: T) => {
      if (!token) return;
      await apiRequest(path, {
        method,
        body: payload ? JSON.stringify(denormalizePayload(payload)) : undefined
      }, token);
      await refreshData();
    },
    [refreshData, token]
  );

  const toggleModulePin = useCallback(
    (moduleId: string) => {
      const workModule = data.modules.find((item) => item.id === moduleId);
      if (!workModule) return;
      void mutate(`/modules/${moduleId}`, "PUT", { ...workModule, isPinnedToSidebar: !workModule.isPinnedToSidebar });
    },
    [data.modules, mutate]
  );

  const markTaskDone = useCallback(
    async (taskId: string, note?: string, photoFileId?: string | null) => {
      if (!token) return;
      const trimmedNote = note?.trim();
      await requestTaskCompletion(token, taskId, {
        note: trimmedNote && trimmedNote.length > 0 ? trimmedNote : null,
        photoFileId: photoFileId ?? null
      });
      await refreshData();
    },
    [refreshData, token]
  );

  const approveTask = useCallback(
    async (userId: string, taskId: string) => {
      if (!token) return;
      await apiRequest(`/admin/tasks/${userId}/${taskId}/approve`, { method: "POST", body: "{}" }, token);
      await refreshData();
    },
    [refreshData, token]
  );

  const rejectTask = useCallback(
    async (userId: string, taskId: string, reason?: string) => {
      if (!token) return;
      const trimmed = reason?.trim();
      await apiRequest(
        `/admin/tasks/${userId}/${taskId}/reject`,
        {
          method: "POST",
          body: JSON.stringify({ reason: trimmed && trimmed.length > 0 ? trimmed : null })
        },
        token
      );
      await refreshData();
    },
    [refreshData, token]
  );

  const promoteUser = useCallback(
    async (id: string) => {
      if (!token) return;
      await apiRequest(`/admin/users/${id}/promote`, { method: "POST", body: "{}" }, token);
    },
    [token]
  );

  const demoteUser = useCallback(
    async (id: string) => {
      if (!token) return;
      await apiRequest(`/admin/users/${id}/demote`, { method: "POST", body: "{}" }, token);
    },
    [token]
  );

  const snoozeTask = useCallback(
    async (taskId: string, options: SnoozeTaskInput) => {
      if (!token) return;
      await snoozeTaskRequest(token, taskId, options);
      await refreshData();
    },
    [refreshData, token]
  );

  const habitStart = useCallback(
    async (taskId: string, input: { startDate: string; reminderTime?: string; intervalDays?: number }) => {
      if (!token) return;
      await habitStartRequest(token, taskId, input);
      await refreshData();
    },
    [refreshData, token]
  );

  const habitSnooze = useCallback(
    async (taskId: string, input?: { days?: number }) => {
      if (!token) return { ok: false, nextNudgeAt: null };
      const result = await habitSnoozeRequest(token, taskId, input ?? {});
      await refreshData();
      return result;
    },
    [refreshData, token]
  );

  const habitStop = useCallback(
    async (taskId: string) => {
      if (!token) return;
      await habitStopRequest(token, taskId);
      await refreshData();
    },
    [refreshData, token]
  );

  const acknowledgeTask = useCallback(
    async (taskId: string) => {
      if (!token) return;
      await acknowledgeTaskRequest(token, taskId);
      await refreshData();
    },
    [refreshData, token]
  );

  const assignTask = useCallback(
    async (input: AssignTaskInput) => {
      if (!token) return;
      await assignAdminTask(token, input);
      await refreshData();
    },
    [refreshData, token]
  );

  const verifyCompanyAddress = useCallback(
    async (companyId: string) => {
      if (!token) throw new Error("Not authenticated.");
      const result = await verifyCompanyAddressRequest(token, companyId);
      await refreshData();
      return result;
    },
    [refreshData, token]
  );

  const geocodeMissingCompanies = useCallback(async () => {
    if (!token) throw new Error("Not authenticated.");
    const result = await geocodeMissingCompaniesRequest(token);
    await refreshData();
    return result;
  }, [refreshData, token]);

  const offerFromUrl = useCallback(
    async (input: { url: string; companyId?: string | null; title?: string | null }) => {
      if (!token) throw new Error("Not authenticated.");
      const result = await offerFromUrlRequest(token, input);
      await refreshData();
      return result;
    },
    [refreshData, token]
  );

  const scanDocument = useCallback(
    async (file: File, options?: { companyId?: string | null; documentType?: string | null }) => {
      if (!token) throw new Error("Not authenticated.");
      const result = await scanDocumentRequest(token, file, { ...options, language });
      await refreshData();
      return result;
    },
    [language, refreshData, token]
  );

  const fetchShoppingItems = useCallback(async () => {
    if (!token) return [];
    return getShoppingItems(token);
  }, [token]);

  const createShoppingItem = useCallback(
    async (input: { name: string; category?: string | null; chain?: string | null }) => {
      if (!token) return null;
      return createShoppingItemRequest(token, input);
    },
    [token]
  );

  const fetchRouteErrands = useCallback(
    async (coords: Array<[number, number]>, bufferMeters?: number): Promise<ErrandMatch[]> => {
      if (!token || coords.length === 0) return [];
      const result = await routeErrandStops(token, { coords, bufferMeters });
      return result.matches ?? [];
    },
    [token]
  );

  const updateShoppingItem = useCallback(
    async (id: string, input: Partial<ShoppingItem>) => {
      if (!token) return null;
      return updateShoppingItemRequest(token, id, input);
    },
    [token]
  );

  const deleteShoppingItem = useCallback(
    async (id: string) => {
      if (!token) return;
      await deleteShoppingItemRequest(token, id);
    },
    [token]
  );

  const fetchWeeklyAnalysis = useCallback(
    async (weekStart?: string) => {
      if (!token) return null;
      return getWeeklyAnalysis(token, weekStart);
    },
    [token]
  );

  const fetchReports = useCallback(
    async (kind?: "daily" | "weekly", limit?: number) => {
      if (!token) return [];
      return getReports(token, kind, limit);
    },
    [token]
  );

  const lateNoticeDraft = useCallback(
    async (input: { taskId: string; delayMinutes: number }) => {
      if (!token) return null;
      return lateNoticeDraftRequest(token, { ...input, language });
    },
    [language, token]
  );

  const lateNoticeLog = useCallback(
    async (input: { taskId: string; message: string; channel: string }) => {
      if (!token) return;
      await lateNoticeLogRequest(token, input);
    },
    [token]
  );

  const assistantAsk = useCallback(
    async (question: string) => {
      if (!token) throw new Error("Not authenticated.");
      const result = await assistantAskRequest(token, { question, language });
      return result.answer;
    },
    [language, token]
  );

  const addTaskNote = useCallback(
    (taskId: string, content?: string) => {
      const task = data.tasks.find((item) => item.id === taskId);
      if (!task) return;
      void mutate("/notes", "POST", {
        id: createId("note"),
        companyId: task.companyId,
        taskId,
        content: content ?? "Quick note added from task card.",
        sourceType: "manual",
        sourceTranscript: null,
        createdAt: new Date().toISOString()
      });
    },
    [data.tasks, mutate]
  );

  const parseInput = useCallback((input: string) => parseBusinessInput(input), []);

  const commitParsedInput = useCallback(
    async (parsed: ParsedBusinessInput, sourceText: string) => {
      if (!token || !parsed.company.name || !parsed.tasks[0]) return null;
      const primaryTask = parsed.tasks[0];
      const snapshot = await apiRequest<AppData>(
        "/ai-capture/commit",
        {
          method: "POST",
          body: JSON.stringify({
            companyName: parsed.company.name,
            moduleNames: parsed.modules.filter((item) => item.confidence >= 0.8).map((item) => item.name),
            taskTitle: primaryTask.title,
            taskType: primaryTask.type,
            dueDate: primaryTask.dueDate,
            dueTime: primaryTask.dueTime,
            timeWindow: primaryTask.timeWindow,
            priority: primaryTask.priority,
            reminderRule: primaryTask.reminderRule,
            sourceText
          })
        },
        token
      );
      setData(recalculateModuleCounts(normalizeSnapshot(snapshot)));
      return parsed.company.name;
    },
    [token]
  );

  const analyzeAndCommitInput = useCallback(
    async (
      sourceText: string,
      sourceType: Extract<SourceType, "voice" | "text">,
      companyResolution?: { existingCompanyId?: string | null; createSeparateCompany?: boolean },
      companyDrafts?: AiCompanyDraftRequest[]
    ) => {
      if (!token) throw new Error("Not authenticated.");
      const result = await apiRequest<AiCaptureResponse>(
        "/ai-capture/analyze-and-commit",
        {
          method: "POST",
          body: JSON.stringify({
            sourceText,
            sourceType,
            language,
            companyResolution,
            companyDraft: companyDrafts?.[0] ?? null,
            companyDrafts: companyDrafts ?? []
          })
        },
        token
      );
      setData(recalculateModuleCounts(normalizeSnapshot(result.snapshot)));
      return result;
    },
    [language, token]
  );

  const createCompany = useCallback((input: Partial<Company>) => mutate("/companies", "POST", normalizeCompany(input)), [mutate]);
  const updateCompany = useCallback((id: string, input: Partial<Company>) => mutate(`/companies/${id}`, "PUT", normalizeCompany(input)), [mutate]);
  const deleteCompany = useCallback((id: string) => mutate(`/companies/${id}`, "DELETE"), [mutate]);
  const createTask = useCallback((input: Partial<Task>) => mutate("/tasks", "POST", normalizeTask(input, data.modules)), [data.modules, mutate]);
  const updateTask = useCallback((id: string, input: Partial<Task>) => mutate(`/tasks/${id}`, "PUT", normalizeTask(input, data.modules)), [data.modules, mutate]);
  const deleteTask = useCallback((id: string) => mutate(`/tasks/${id}`, "DELETE"), [mutate]);
  const createModule = useCallback((input: Partial<WorkModule>) => mutate("/modules", "POST", normalizeModule(input)), [mutate]);
  const deleteModule = useCallback((id: string) => mutate(`/modules/${id}`, "DELETE"), [mutate]);
  const createNote = useCallback((input: Partial<Note>) => mutate("/notes", "POST", normalizeNote(input)), [mutate]);
  const createProduct = useCallback((input: Partial<Product>) => mutate("/products", "POST", normalizeProduct(input)), [mutate]);
  const createOffer = useCallback((input: Partial<Offer>) => mutate("/offers", "POST", normalizeOffer(input)), [mutate]);
  const updateOffer = useCallback((id: string, input: Partial<Offer>) => mutate(`/offers/${id}`, "PUT", normalizeOffer(input)), [mutate]);
  const deleteOffer = useCallback((id: string) => mutate(`/offers/${id}`, "DELETE"), [mutate]);
  const sendOffer = useCallback((id: string) => mutate(`/offers/${id}/send`, "POST"), [mutate]);
  const acceptOffer = useCallback((id: string) => mutate(`/offers/${id}/accept`, "POST"), [mutate]);
  const convertOfferToInvoice = useCallback((id: string) => mutate(`/offers/${id}/convert-to-invoice`, "POST"), [mutate]);
  const createInvoice = useCallback((input: Partial<Invoice>) => mutate("/invoices", "POST", normalizeInvoice(input)), [mutate]);
  const markInvoicePaid = useCallback((id: string) => mutate(`/invoices/${id}/mark-paid`, "POST"), [mutate]);
  const createDocument = useCallback((input: Partial<DocumentRecord>) => mutate("/documents", "POST", normalizeDocument(input)), [mutate]);
  const createReminder = useCallback((input: Partial<Reminder>) => mutate("/reminders", "POST", normalizeReminder(input)), [mutate]);

  const value = useMemo<AppStateContextValue>(
    () => ({
      data,
      language,
      theme,
      sidebarCollapsed,
      loadingData,
      settings,
      setLanguage,
      setTheme,
      toggleSidebar,
      toggleModulePin,
      markTaskDone,
      approveTask,
      rejectTask,
      promoteUser,
      demoteUser,
      snoozeTask,
      habitStart,
      habitSnooze,
      habitStop,
      acknowledgeTask,
      assignTask,
      refreshSettings,
      updateSettings,
      verifyCompanyAddress,
      geocodeMissingCompanies,
      offerFromUrl,
      scanDocument,
      fetchShoppingItems,
      createShoppingItem,
      updateShoppingItem,
      deleteShoppingItem,
      fetchRouteErrands,
      fetchWeeklyAnalysis,
      fetchReports,
      lateNoticeDraft,
      lateNoticeLog,
      assistantAsk,
      addTaskNote,
      parseInput,
      commitParsedInput,
      analyzeAndCommitInput,
      refreshData,
      createCompany,
      updateCompany,
      deleteCompany,
      createTask,
      updateTask,
      deleteTask,
      createModule,
      deleteModule,
      createNote,
      createProduct,
      createOffer,
      updateOffer,
      deleteOffer,
      sendOffer,
      acceptOffer,
      convertOfferToInvoice,
      createInvoice,
      markInvoicePaid,
      createDocument,
      createReminder,
      t
    }),
    [
      acceptOffer,
      acknowledgeTask,
      addTaskNote,
      analyzeAndCommitInput,
      assignTask,
      assistantAsk,
      commitParsedInput,
      convertOfferToInvoice,
      createCompany,
      createDocument,
      createInvoice,
      createModule,
      createNote,
      createOffer,
      createProduct,
      createReminder,
      createShoppingItem,
      createTask,
      data,
      deleteCompany,
      deleteOffer,
      deleteShoppingItem,
      deleteTask,
      deleteModule,
      fetchReports,
      fetchRouteErrands,
      fetchShoppingItems,
      fetchWeeklyAnalysis,
      geocodeMissingCompanies,
      habitStart,
      habitSnooze,
      habitStop,
      language,
      lateNoticeDraft,
      lateNoticeLog,
      loadingData,
      markInvoicePaid,
      markTaskDone,
      approveTask,
      offerFromUrl,
      rejectTask,
      promoteUser,
      demoteUser,
      parseInput,
      refreshData,
      refreshSettings,
      scanDocument,
      sendOffer,
      setLanguage,
      setTheme,
      settings,
      sidebarCollapsed,
      snoozeTask,
      t,
      theme,
      toggleModulePin,
      toggleSidebar,
      updateCompany,
      updateOffer,
      updateSettings,
      updateShoppingItem,
      updateTask,
      verifyCompanyAddress
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) throw new Error("useAppState must be used within AppDataProvider");
  return context;
}

export function getModuleLabelKey(module: WorkModule) {
  return moduleTranslationKey[module.id.replace("module-", "")] ?? moduleTranslationKey[module.type] ?? module.name;
}

function recalculateModuleCounts(data: AppData): AppData {
  return {
    ...data,
    modules: data.modules.map((module) => ({
      ...module,
      taskCount: data.tasks.filter((task) => task.moduleIds.includes(module.id) && task.status !== "done").length
    }))
  };
}

function readStorage<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizeModuleType(type: string): ModuleType {
  return moduleTypeByName[type.toLowerCase()] ?? "todo";
}

function normalizeCompany(input: Partial<Company>): Company {
  return {
    id: input.id ?? createId("company"),
    name: input.name ?? "",
    address: input.address ?? "",
    phone: input.phone ?? "",
    email: input.email ?? "",
    contactPerson: input.contactPerson ?? "",
    latitude: input.latitude ?? 0,
    longitude: input.longitude ?? 0,
    status: input.status ?? "new",
    tags: input.tags ?? [],
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeModule(input: Partial<WorkModule>): WorkModule {
  const name = input.name ?? "Custom";
  return {
    id: input.id ?? `module-${slugify(name)}`,
    name,
    type: input.type ?? "custom",
    createdByAI: input.createdByAI ?? false,
    isPinnedToSidebar: input.isPinnedToSidebar ?? true,
    taskCount: input.taskCount ?? 0,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

function normalizeTask(input: Partial<Task>, modules: WorkModule[]): Task {
  const fallbackModule = modules.find((module) => module.type === "todo")?.id ?? "module-todo";
  return {
    id: input.id ?? createId("task"),
    companyId: input.companyId ?? null,
    title: input.title ?? "",
    description: input.description ?? "",
    type: input.type ? normalizeModuleType(input.type) : "todo",
    moduleIds: input.moduleIds?.length ? input.moduleIds : [fallbackModule],
    // Empty/omitted due date → undated ("zamansız") task. The backend treats a
    // null dueDate as a reminder-free, never-overdue personal task.
    dueDate: input.dueDate ? input.dueDate : null,
    dueTime: input.dueTime ?? null,
    timeWindow: input.timeWindow ?? null,
    reminderInterval: input.reminderInterval ?? null,
    repeatUntilDone: input.repeatUntilDone ?? false,
    status: input.status ?? "open",
    priority: input.priority ?? "medium",
    notificationsEnabled: input.notificationsEnabled ?? true,
    nextAlertAt: input.nextAlertAt ?? null,
    alertCount: input.alertCount ?? 0,
    createdAt: input.createdAt ?? new Date().toISOString(),
    completedAt: input.completedAt ?? null
  };
}

function normalizeNote(input: Partial<Note>): Note {
  return {
    id: input.id ?? createId("note"),
    companyId: input.companyId ?? null,
    taskId: input.taskId ?? null,
    content: input.content ?? "",
    sourceType: input.sourceType ?? "manual",
    sourceTranscript: input.sourceTranscript ?? null,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

function normalizeProduct(input: Partial<Product>): Product {
  const sellingPrice = input.sellingPrice ?? 0;
  const costPrice = input.costPrice ?? 0;
  return {
    id: input.id ?? createId("product"),
    name: input.name ?? "",
    category: input.category ?? "Custom Services",
    description: input.description ?? "",
    costPrice,
    sellingPrice,
    minimumPrice: input.minimumPrice ?? sellingPrice,
    currency: input.currency ?? "EUR",
    margin: input.margin ?? (sellingPrice > 0 ? (sellingPrice - costPrice) / sellingPrice : 0),
    updatedAt: input.updatedAt ?? isoDate(0)
  };
}

function normalizeOffer(input: Partial<Offer>): Offer {
  const items = input.items?.length
    ? input.items
    : [{ id: createId("offer-item"), productName: "Service", description: "", quantity: 1, unitPrice: 0, totalPrice: 0 }];
  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const vatRate = input.vatRate ?? 0.19;
  const vatAmount = subtotal * vatRate;
  return {
    id: input.id ?? createId("offer"),
    companyId: input.companyId ?? "",
    offerNumber: input.offerNumber ?? `AN-${Date.now()}`,
    offerDate: input.offerDate ?? isoDate(0),
    title: input.title ?? "",
    status: input.status ?? "draft",
    items,
    subtotal,
    vatRate,
    vatAmount,
    total: subtotal + vatAmount,
    currency: input.currency ?? "EUR",
    validityDays: input.validityDays ?? 14,
    notes: input.notes ?? "",
    pdfUrl: input.pdfUrl ?? null
  };
}

function normalizeInvoice(input: Partial<Invoice>): Invoice {
  const items = input.items?.length
    ? input.items
    : [{ id: createId("invoice-item"), productName: "Service", description: "", quantity: 1, unitPrice: 0, totalPrice: 0 }];
  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const vatRate = input.vatRate ?? 0.19;
  return {
    id: input.id ?? createId("invoice"),
    companyId: input.companyId ?? "",
    invoiceNumber: input.invoiceNumber ?? `RE-${Date.now()}`,
    invoiceDate: input.invoiceDate ?? isoDate(0),
    dueDate: input.dueDate ?? isoDate(14),
    status: input.status ?? "unpaid",
    items,
    subtotal,
    vatRate,
    total: subtotal + subtotal * vatRate,
    paidAt: input.paidAt ?? null
  };
}

function normalizeDocument(input: Partial<DocumentRecord>): DocumentRecord {
  return {
    id: input.id ?? createId("doc"),
    companyId: input.companyId ?? null,
    fileName: input.fileName ?? "",
    fileType: input.fileType ?? "application/pdf",
    documentType: input.documentType ?? "PDF",
    extractedText: input.extractedText ?? "",
    summary: input.summary ?? "",
    uploadedAt: input.uploadedAt ?? new Date().toISOString()
  };
}

function normalizeReminder(input: Partial<Reminder>): Reminder {
  return {
    id: input.id ?? createId("reminder"),
    taskId: input.taskId ?? "",
    startTime: input.startTime ?? isoDate(0),
    repeatInterval: input.repeatInterval ?? "Daily",
    activeUntilDone: input.activeUntilDone ?? true,
    status: input.status ?? "active",
    notificationsEnabled: input.notificationsEnabled ?? true
  };
}

export function getCompanyById(data: AppData, companyId: string | null) {
  return data.companies.find((company) => company.id === companyId) ?? null;
}

export function getModuleNames(data: AppData, moduleIds: string[]) {
  return moduleIds
    .map((moduleId) => data.modules.find((module) => module.id === moduleId)?.name)
    .filter(Boolean) as string[];
}

export function getTodayTasks(data: AppData) {
  const today = isoDate(0);
  return data.tasks.filter((task) => task.dueDate === today && task.status !== "done");
}

export function getTomorrowTasks(data: AppData) {
  const tomorrow = isoDate(1);
  return data.tasks.filter((task) => task.dueDate === tomorrow && task.status !== "done");
}

export function getUndatedTasks(data: AppData) {
  // "Zamansız görevler": personal/errand tasks with no due date. `!task.dueDate`
  // catches both null and empty string. Date-based lists compare against a
  // concrete isoDate, so they already exclude these. Habits are excluded — they
  // live only in the dedicated "Alışkanlıklar" section.
  return data.tasks.filter((task) => !task.dueDate && !task.isHabit && task.status !== "done");
}

export function getHabits(data: AppData) {
  // Active/planning personal goals ("alışkanlıklar"). Stopped or completed
  // habits drop out of the section.
  return data.tasks.filter((task) => task.isHabit && task.habitStage !== "stopped" && task.status !== "done");
}

export function directionClass(language: LanguageCode) {
  return isRtl(language) ? "rtl" : "ltr";
}
