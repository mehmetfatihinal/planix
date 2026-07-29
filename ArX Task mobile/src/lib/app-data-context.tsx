import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  acknowledgeTask as acknowledgeTaskRequest,
  getSettings as getSettingsRequest,
  isPhotoRequiredError,
  listShoppingSellers,
  routeErrandStops,
  normalizeSnapshot,
  snoozeTaskRequest,
  updateSettings as updateSettingsRequest,
  acceptOffer as acceptOfferRequest,
  addNote,
  analyzeAndCommitCapture,
  convertOfferToInvoice as convertOfferToInvoiceRequest,
  createCompany as createCompanyRequest,
  createDocument as createDocumentRequest,
  createInvoice as createInvoiceRequest,
  createModule as createModuleRequest,
  createOffer as createOfferRequest,
  createProduct as createProductRequest,
  createReminder as createReminderRequest,
  createTask as createTaskRequest,
  archiveCompany as archiveCompanyRequest,
  unarchiveCompany as unarchiveCompanyRequest,
  deleteCompany as deleteCompanyRequest,
  deleteDocument as deleteDocumentRequest,
  deleteInvoice as deleteInvoiceRequest,
  deleteModule as deleteModuleRequest,
  deleteOffer as deleteOfferRequest,
  deleteProduct as deleteProductRequest,
  deleteReminder as deleteReminderRequest,
  deleteTask as deleteTaskRequest,
  habitStart as habitStartRequest,
  habitSnooze as habitSnoozeRequest,
  habitStop as habitStopRequest,
  emptyData,
  getSnapshot,
  markInvoicePaid as markInvoicePaidRequest,
  sendOffer as sendOfferRequest,
  updateCompany as updateCompanyRequest,
  updateDocument as updateDocumentRequest,
  updateInvoice as updateInvoiceRequest,
  updateModule as updateModuleRequest,
  updateOffer as updateOfferRequest,
  updateProduct as updateProductRequest,
  updateReminder as updateReminderRequest,
  updateTask as updateTaskRequest,
  requestTaskCompletion,
  approveTaskRequest,
  rejectTaskRequest,
  promoteUser as promoteUserRequest,
  demoteUser as demoteUserRequest
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { syncHabitReminders, syncLocalTaskReminders } from "@/lib/notifications";
import {
  loadStoredTaskOpportunities,
  persistAutoRouteInputs,
  persistErrandGeofences,
  persistTaskOpportunities,
  syncGeofences,
  type ErrandGeofenceInput
} from "@/lib/geofencing";
import { hasUsableCoordinates } from "@/lib/location";
import { useUserLocation } from "@/lib/location-context";
import { findTaskOpportunities, MAX_TASK_OPPORTUNITY_REGIONS } from "@/lib/route-opportunities";
import { captureAndUploadTaskPhoto } from "@/lib/task-photo";
import {
  normalizeCompany,
  normalizeDocument,
  normalizeInvoice,
  normalizeModule,
  normalizeOffer,
  normalizeProduct,
  normalizeReminder,
  normalizeTask
} from "@/lib/record-utils";
import type {
  AiCaptureResponse,
  AiCompanyDraftRequest,
  AiCompanyResolutionRequest,
  AppData,
  AppSettings,
  Company,
  DocumentRecord,
  ErrandMatch,
  Invoice,
  Offer,
  Product,
  Reminder,
  Task,
  WorkModule
} from "@/types/business";

interface AppDataContextValue {
  data: AppData;
  loading: boolean;
  refreshing: boolean;
  // True while the shown snapshot came from the on-device cache (offline start) and no
  // fresh network snapshot has replaced it yet.
  isFromCache: boolean;
  settings: AppSettings | null;
  lastCapture: AiCaptureResponse | null;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  markTaskDone: (task: Task, note?: string) => Promise<void>;
  acknowledgeTask: (taskId: string) => Promise<void>;
  approveTask: (userId: string, taskId: string) => Promise<void>;
  rejectTask: (userId: string, taskId: string, reason?: string) => Promise<void>;
  promoteUser: (userId: string) => Promise<void>;
  demoteUser: (userId: string) => Promise<void>;
  snoozeTask: (task: Task, hours: number, reason?: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  addTaskNote: (task: Task, content: string) => Promise<void>;
  createTask: (input: Partial<Task>) => Promise<void>;
  updateTask: (task: Task) => Promise<void>;
  createCompany: (input: Partial<Company>) => Promise<void>;
  updateCompany: (company: Company) => Promise<void>;
  archiveCompany: (companyId: string) => Promise<void>;
  unarchiveCompany: (companyId: string) => Promise<void>;
  deleteCompany: (companyId: string) => Promise<void>;
  createModule: (input: Partial<WorkModule>) => Promise<void>;
  updateModule: (module: WorkModule) => Promise<void>;
  deleteModule: (moduleId: string) => Promise<void>;
  createProduct: (input: Partial<Product>) => Promise<void>;
  updateProduct: (product: Product) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  createOffer: (input: Partial<Offer>) => Promise<void>;
  updateOffer: (offer: Offer) => Promise<void>;
  deleteOffer: (offerId: string) => Promise<void>;
  sendOffer: (offerId: string) => Promise<void>;
  acceptOffer: (offerId: string) => Promise<void>;
  convertOfferToInvoice: (offerId: string) => Promise<void>;
  createInvoice: (input: Partial<Invoice>) => Promise<void>;
  updateInvoice: (invoice: Invoice) => Promise<void>;
  deleteInvoice: (invoiceId: string) => Promise<void>;
  markInvoicePaid: (invoiceId: string) => Promise<void>;
  createDocument: (input: Partial<DocumentRecord>) => Promise<void>;
  updateDocument: (document: DocumentRecord) => Promise<void>;
  deleteDocument: (documentId: string) => Promise<void>;
  createReminder: (input: Partial<Reminder>) => Promise<void>;
  updateReminder: (reminder: Reminder) => Promise<void>;
  deleteReminder: (reminderId: string) => Promise<void>;
  // Aktif (durdurulmamış, tamamlanmamış) alışkanlıklar.
  habits: Task[];
  habitStart: (taskId: string, payload: { startDate: string; reminderTime?: string; intervalDays?: number }) => Promise<void>;
  habitSnooze: (taskId: string, days?: number) => Promise<void>;
  habitStop: (taskId: string) => Promise<void>;
  analyzeCapture: (
    sourceText: string,
    sourceType: "voice" | "text",
    language: string,
    companyResolution?: AiCompanyResolutionRequest,
    companyDrafts?: AiCompanyDraftRequest[]
  ) => Promise<AiCaptureResponse>;
  // "Yola çıkmadan önce" errands along the route corridor. Returns the matched shops
  // (nearest-to-route first) for the summary UI.
  fetchRouteErrands: (coords: Array<[number, number]>, bufferMeters?: number) => Promise<ErrandMatch[]>;
  // Registers the matched shops as OS geofences (persisted so they survive re-syncs until the
  // route ends). Pass an empty list to clear a previous route's errand geofences.
  registerErrandGeofences: (errands: ErrandGeofenceInput[]) => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

// R9 — offline snapshot cache. The whole snapshot is one JSON blob; persisting/hydrating
// it keeps the memory footprint at a single parsed copy.
const SNAPSHOT_CACHE_KEY = "arx:snapshot-cache";

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [data, setData] = useState<AppData>(emptyData());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isFromCache, setIsFromCache] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [lastCapture, setLastCapture] = useState<AiCaptureResponse | null>(null);

  const { state: userLocationState } = useUserLocation();
  // Ref: konum değişimi rebuildGeofences'ı yeniden tetiklemesin, ama en güncel
  // değeri okuyabilelim.
  const locationRef = useRef(userLocationState.coords);
  useEffect(() => {
    locationRef.current = userLocationState.coords;
  }, [userLocationState.coords]);

  const persistSnapshot = (snapshot: AppData) => {
    AsyncStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot)).catch(() => undefined);
  };

  const refresh = async () => {
    if (!token) {
      setData(emptyData());
      setSettings(null);
      setIsFromCache(false);
      setLoading(false);
      return;
    }

    setRefreshing(true);
    try {
      const snapshot = await getSnapshot(token);
      setData(snapshot);
      setIsFromCache(false);
      persistSnapshot(snapshot);
      // Settings ride along with every refresh; tolerated to fail (older backend).
      getSettingsRequest(token).then(setSettings).catch(() => undefined);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setData(emptyData());
      setSettings(null);
      setIsFromCache(false);
      setLoading(false);
      return;
    }

    // Hydrate from the on-device cache FIRST so the app is usable offline, then refresh
    // from the network in the background.
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SNAPSHOT_CACHE_KEY);
        if (!cancelled && raw) {
          setData(normalizeSnapshot(JSON.parse(raw) as AppData));
          setIsFromCache(true);
          setLoading(false);
        }
      } catch {
        // Corrupt cache → ignore, network refresh follows.
      }
      refresh().catch(() => {
        setLoading(false);
        setRefreshing(false);
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Keep an on-device local-notification schedule in sync with the current tasks. This is
  // the reliability fallback for task reminders: even if the server → Expo → FCM push chain
  // fails, the OS still fires the reminder at the task's due time. Rebuilt whenever tasks or
  // companies change.
  useEffect(() => {
    const companyNameFor = (companyId: string | null) =>
      companyId ? data.companies.find((company) => company.id === companyId)?.name ?? null : null;
    // Fire the local reminder N minutes BEFORE the appointment (user-configurable lead).
    const leadMinutes = settings?.defaultReminderLeadMinutes ?? 0;
    const applyLead = (dueAt: Date | null) =>
      dueAt && leadMinutes > 0 ? new Date(dueAt.getTime() - leadMinutes * 60_000) : dueAt;
    const reminders = data.tasks
      // Alışkanlıklar (isHabit) buraya girmez — onların bildirimleri syncHabitReminders'ta yönetilir.
      .filter((task) => task.notificationsEnabled !== false && task.status !== "done" && !task.isHabit)
      .map((task) => ({
        id: task.id,
        title: task.title,
        dueAt: applyLead(mergeDueDateTime(task.dueDate, task.dueTime)),
        companyName: companyNameFor(task.companyId)
      }));
    syncLocalTaskReminders(reminders).catch(() => undefined);
  }, [data.tasks, data.companies, settings?.defaultReminderLeadMinutes]);

  // Alışkanlık (habit) yerel bildirimleri. Planning → her N günde bir "ne zaman
  // başlamak istiyorsun?" dürtüsü; active → habitReminderTime saatinde günlük
  // hatırlatma. Yalnızca habit-ilgili alanlar değiştiğinde yeniden kurulur (imza) —
  // böylece her snapshot yenilemesinde dürtünün geri sayımı sıfırlanmaz.
  const habitSignature = useMemo(
    () =>
      data.tasks
        .filter((task) => task.isHabit)
        .map((task) => `${task.id}:${task.habitStage ?? ""}:${task.habitReminderTime ?? ""}:${task.nudgeIntervalDays ?? ""}:${task.status}`)
        .join("|"),
    [data.tasks]
  );

  useEffect(() => {
    const habits = data.tasks
      .filter((task) => task.isHabit && task.status !== "done" && task.habitStage !== "stopped")
      .map((task) => ({
        id: task.id,
        title: task.title,
        stage: (task.habitStage === "active" ? "active" : "planning") as "active" | "planning",
        reminderTime: task.habitReminderTime ?? null,
        nudgeIntervalDays: task.nudgeIntervalDays ?? 2
      }));
    syncHabitReminders(habits).catch(() => undefined);
    // habitSignature değişimi habit alanlarındaki değişimi temsil eder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habitSignature]);

  // Rebuilds the OS-level geofence set: home region (exit → auto daily route), TODAY's task
  // companies (1km enter → proximity reminder), route errands (enter → "shop on the way") and
  // shopping sellers (enter → "item nearby"). The 20-region OS budget is prioritized
  // home → companies → errands → sellers inside syncGeofences (errands read from their own
  // persisted store). Also persists the minimal auto-route inputs the headless home-exit
  // handler needs. Exposed as a callback so starting a route can trigger a fresh rebuild that
  // folds in the just-registered errand POIs.
  const rebuildGeofences = useCallback(async () => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const groups = new Map<string, { companyId: string; companyName: string; latitude: number; longitude: number; tasks: Task[] }>();
    const todayTasks: Task[] = [];
    for (const task of data.tasks) {
      if (task.status === "done" || task.dueDate !== todayKey || !task.companyId) continue;
      todayTasks.push(task);
      const company = data.companies.find((item) => item.id === task.companyId);
      if (!company || !hasUsableCoordinates(company)) continue;
      const existing =
        groups.get(company.id) ??
        { companyId: company.id, companyName: company.name, latitude: company.latitude, longitude: company.longitude, tasks: [] };
      existing.tasks.push(task);
      groups.set(company.id, existing);
    }
    const geofenceReminders = Array.from(groups.values()).map((group) => ({
      companyId: group.companyId,
      companyName: group.companyName,
      latitude: group.latitude,
      longitude: group.longitude,
      taskId: group.tasks[0].id,
      taskTitle: group.tasks[0].title,
      taskCount: group.tasks.length
    }));

    // NOT: persistAutoRouteInputs TÜM açık görevleri kabul edip kendi içinde filtreler
    // (bkz. tanımı) — `todayTasks` (sadece bugüne tarihli) geçilirse handleHomeExit'in
    // yeniden türettiği bugünün görevleri tüm görev kümesiyle çakışır ve excludeCompanyIds
    // her firmayı dışlayarak fırsat listesini her zaman boşaltır. Tam listeyi geçiyoruz.
    await persistAutoRouteInputs(data.tasks, data.companies).catch(() => undefined);

    // Rota kaynaklı fırsat listesi bugüne aitse dokunma — o sabah kurulan liste
    // gün içindeki veri senkronuyla ezilmemeli. Aksi hâlde rota yokken konuma
    // en yakın açık iş firmalarını izlemeye al (üst mesafe sınırı yok).
    const storedOpportunities = await loadStoredTaskOpportunities().catch(() => null);
    const hasRouteOpportunities = storedOpportunities?.date === todayKey && storedOpportunities.source === "route";
    if (!hasRouteOpportunities) {
      const origin = locationRef.current;
      const nearby = origin
        ? findTaskOpportunities({
            tasks: data.tasks.filter((task) => task.status !== "done" && Boolean(task.companyId)),
            companies: data.companies,
            corridor: [origin],
            bufferMeters: null,
            excludeCompanyIds: Array.from(groups.keys()),
            limit: MAX_TASK_OPPORTUNITY_REGIONS
          })
        : [];
      await persistTaskOpportunities({ date: todayKey, source: "nearby", items: nearby }).catch(
        () => undefined
      );
    }

    const sellers = token
      ? await listShoppingSellers(token)
          .then((rows) =>
            rows.map((row) => ({
              itemId: row.itemId,
              itemName: row.itemName,
              companyId: row.companyId,
              companyName: row.companyName,
              latitude: row.latitude,
              longitude: row.longitude
            }))
          )
          .catch(() => [])
      : [];

    const home =
      settings && hasUsableCoordinates({ latitude: settings.homeLatitude, longitude: settings.homeLongitude })
        ? { latitude: settings.homeLatitude!, longitude: settings.homeLongitude! }
        : null;

    await syncGeofences({ companies: geofenceReminders, home, sellers });
  }, [data.tasks, data.companies, settings?.homeLatitude, settings?.homeLongitude, token]);

  useEffect(() => {
    rebuildGeofences().catch(() => undefined);
  }, [rebuildGeofences]);

  // Açılışta GPS henüz yokken çalışan ilk rebuild, o günün "nearby" kaydını boş
  // yazmış olabilir ve konum sonradan gelse bile hiçbir şey onu düzeltmez (veri
  // değişmediği sürece rebuildGeofences yeniden tetiklenmez). Konum İLK KEZ
  // mevcut olduğunda tam olarak bir kez daha yeniden hesapla. Bayrak bir ref'te
  // tutulur — konum dependency array'e eklenmez — böylece sonraki her GPS
  // güncellemesi bu efekti yeniden tetiklemez. locationRef.current, yukarıdaki
  // senkronizasyon efekti (aynı render'da daha önce bildirilmiş) tarafından bu
  // efekt çalışmadan önce zaten güncellenmiş olur, böylece rebuildGeofences bayat
  // (stale) değeri değil taze konumu okur.
  const hasTriggeredLocationRebuildRef = useRef(false);
  useEffect(() => {
    if (hasTriggeredLocationRebuildRef.current || !userLocationState.coords) return;
    hasTriggeredLocationRebuildRef.current = true;
    rebuildGeofences().catch(() => undefined);
  }, [userLocationState.coords, rebuildGeofences]);

  const value = useMemo<AppDataContextValue>(
    () => ({
      data,
      loading,
      refreshing,
      isFromCache,
      settings,
      lastCapture,
      refresh,
      updateSettings: async (patch) => {
        if (!token) return;
        const next = await updateSettingsRequest(token, patch);
        setSettings(next);
      },
      // R17 — photo-proof completion: when the task demands photo proof (flag on the task,
      // or the server answering 400 { requiresPhoto: true }), capture + upload a photo and
      // retry the completion request with the file id. Cancelling the photo aborts silently.
      markTaskDone: async (task, note) => {
        if (!token) return;
        if (task.requirePhotoProof && !task.completionPhotoId) {
          const photoFileId = await captureAndUploadTaskPhoto(token, task.id);
          if (!photoFileId) return;
          await requestTaskCompletion(token, task.id, note, photoFileId);
          await refresh();
          return;
        }
        try {
          await requestTaskCompletion(token, task.id, note);
        } catch (error) {
          if (!isPhotoRequiredError(error)) throw error;
          const photoFileId = await captureAndUploadTaskPhoto(token, task.id);
          if (!photoFileId) return;
          await requestTaskCompletion(token, task.id, note, photoFileId);
        }
        await refresh();
      },
      acknowledgeTask: async (taskId) => {
        if (!token) return;
        await acknowledgeTaskRequest(token, taskId);
        await refresh();
      },
      approveTask: async (userId, taskId) => {
        if (!token) return;
        await approveTaskRequest(token, userId, taskId);
        await refresh();
      },
      rejectTask: async (userId, taskId, reason) => {
        if (!token) return;
        await rejectTaskRequest(token, userId, taskId, reason);
        await refresh();
      },
      promoteUser: async (userId) => {
        if (!token) return;
        await promoteUserRequest(token, userId);
      },
      demoteUser: async (userId) => {
        if (!token) return;
        await demoteUserRequest(token, userId);
      },
      // R14 — snooze via the dedicated endpoint so the delay reason lands server-side.
      snoozeTask: async (task, hours, reason) => {
        if (!token) return;
        await snoozeTaskRequest(token, task.id, { hours, reason: reason ?? null });
        await refresh();
      },
      cancelTask: async (taskId) => {
        if (!token) return;
        await deleteTaskRequest(token, taskId);
        await refresh();
      },
      addTaskNote: async (task, content) => {
        if (!token || !content.trim()) return;
        await addNote(token, {
          companyId: task.companyId,
          taskId: task.id,
          content: content.trim(),
          sourceType: "manual",
          sourceTranscript: null
        });
        await refresh();
      },
      createTask: async (input) => {
        if (!token) return;
        await createTaskRequest(token, normalizeTask(input, data.modules));
        await refresh();
      },
      updateTask: async (task) => {
        if (!token) return;
        await updateTaskRequest(token, normalizeTask(task, data.modules));
        await refresh();
      },
      createCompany: async (input) => {
        if (!token) return;
        await createCompanyRequest(token, normalizeCompany(input));
        await refresh();
      },
      updateCompany: async (company) => {
        if (!token) return;
        await updateCompanyRequest(token, normalizeCompany(company));
        await refresh();
      },
      archiveCompany: async (companyId) => {
        if (!token) return;
        await archiveCompanyRequest(token, companyId);
        await refresh();
      },
      unarchiveCompany: async (companyId) => {
        if (!token) return;
        await unarchiveCompanyRequest(token, companyId);
        await refresh();
      },
      deleteCompany: async (companyId) => {
        if (!token) return;
        await deleteCompanyRequest(token, companyId);
        await refresh();
      },
      createModule: async (input) => {
        if (!token) return;
        await createModuleRequest(token, normalizeModule(input));
        await refresh();
      },
      updateModule: async (module) => {
        if (!token) return;
        await updateModuleRequest(token, normalizeModule(module));
        await refresh();
      },
      deleteModule: async (moduleId) => {
        if (!token) return;
        await deleteModuleRequest(token, moduleId);
        await refresh();
      },
      createProduct: async (input) => {
        if (!token) return;
        await createProductRequest(token, normalizeProduct(input));
        await refresh();
      },
      updateProduct: async (product) => {
        if (!token) return;
        await updateProductRequest(token, normalizeProduct(product));
        await refresh();
      },
      deleteProduct: async (productId) => {
        if (!token) return;
        await deleteProductRequest(token, productId);
        await refresh();
      },
      createOffer: async (input) => {
        if (!token) return;
        await createOfferRequest(token, normalizeOffer(input));
        await refresh();
      },
      updateOffer: async (offer) => {
        if (!token) return;
        await updateOfferRequest(token, normalizeOffer(offer));
        await refresh();
      },
      deleteOffer: async (offerId) => {
        if (!token) return;
        await deleteOfferRequest(token, offerId);
        await refresh();
      },
      sendOffer: async (offerId) => {
        if (!token) return;
        await sendOfferRequest(token, offerId);
        await refresh();
      },
      acceptOffer: async (offerId) => {
        if (!token) return;
        await acceptOfferRequest(token, offerId);
        await refresh();
      },
      convertOfferToInvoice: async (offerId) => {
        if (!token) return;
        await convertOfferToInvoiceRequest(token, offerId);
        await refresh();
      },
      createInvoice: async (input) => {
        if (!token) return;
        await createInvoiceRequest(token, normalizeInvoice(input));
        await refresh();
      },
      updateInvoice: async (invoice) => {
        if (!token) return;
        await updateInvoiceRequest(token, normalizeInvoice(invoice));
        await refresh();
      },
      deleteInvoice: async (invoiceId) => {
        if (!token) return;
        await deleteInvoiceRequest(token, invoiceId);
        await refresh();
      },
      markInvoicePaid: async (invoiceId) => {
        if (!token) return;
        await markInvoicePaidRequest(token, invoiceId);
        await refresh();
      },
      createDocument: async (input) => {
        if (!token) return;
        await createDocumentRequest(token, normalizeDocument(input));
        await refresh();
      },
      updateDocument: async (document) => {
        if (!token) return;
        await updateDocumentRequest(token, normalizeDocument(document));
        await refresh();
      },
      deleteDocument: async (documentId) => {
        if (!token) return;
        await deleteDocumentRequest(token, documentId);
        await refresh();
      },
      createReminder: async (input) => {
        if (!token) return;
        await createReminderRequest(token, normalizeReminder(input));
        await refresh();
      },
      updateReminder: async (reminder) => {
        if (!token) return;
        await updateReminderRequest(token, normalizeReminder(reminder));
        await refresh();
      },
      deleteReminder: async (reminderId) => {
        if (!token) return;
        await deleteReminderRequest(token, reminderId);
        await refresh();
      },
      habits: data.tasks.filter((task) => task.isHabit && task.habitStage !== "stopped" && task.status !== "done"),
      habitStart: async (taskId, payload) => {
        if (!token) return;
        await habitStartRequest(token, taskId, payload);
        await refresh();
      },
      habitSnooze: async (taskId, days) => {
        if (!token) return;
        await habitSnoozeRequest(token, taskId, { days });
        await refresh();
      },
      habitStop: async (taskId) => {
        if (!token) return;
        await habitStopRequest(token, taskId);
        await refresh();
      },
      analyzeCapture: async (sourceText, sourceType, language, companyResolution, companyDrafts) => {
        if (!token) {
          throw new Error("Not authenticated.");
        }
        const response = await analyzeAndCommitCapture(token, sourceText, sourceType, language, companyResolution, companyDrafts);
        setLastCapture(response);
        setData(response.snapshot);
        setIsFromCache(false);
        persistSnapshot(response.snapshot);
        return response;
      },
      fetchRouteErrands: async (coords, bufferMeters) => {
        if (!token || !coords.length) return [];
        const response = await routeErrandStops(token, { coords, bufferMeters });
        return response.matches ?? [];
      },
      registerErrandGeofences: async (errands) => {
        // Persist first so the rebuild (and every later re-sync) folds the shops in.
        await persistErrandGeofences(errands);
        await rebuildGeofences();
      }
    }),
    [data, isFromCache, lastCapture, loading, rebuildGeofences, refreshing, settings, token]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error("useAppData must be used within AppDataProvider");
  }
  return context;
}

function mergeDueDateTime(dueDate: string | null, dueTime: string | null) {
  if (!dueDate) return null;
  const time = dueTime ?? "09:00";
  const date = new Date(`${dueDate}T${time}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
