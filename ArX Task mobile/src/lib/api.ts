import Constants from "expo-constants";
import type {
  AiCompanyDraftRequest,
  AiCompanyResolutionRequest,
  AiCaptureResponse,
  AppData,
  AppSettings,
  AuthResponse,
  AuthUser,
  Company,
  DocumentRecord,
  ErrandMatch,
  Invoice,
  LateNoticeDraft,
  MobileNotificationStatus,
  Note,
  Offer,
  Product,
  Reminder,
  RoutePlan,
  ShoppingItem,
  ShoppingSeller,
  Task,
  UploadedFile,
  WeeklyAnalysisReport,
  WorkModule
} from "@/types/business";

const extras = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  defaultLanguage?: string;
};

const devApiUrl = process.env.EXPO_PUBLIC_API_URL ?? extras.apiUrl ?? "http://10.0.2.2:5000";
const releaseApiUrl = extras.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? "https://api.megaajans.de";

export const API_URL = __DEV__ ? devApiUrl : releaseApiUrl;
export const DEFAULT_LANGUAGE = (process.env.EXPO_PUBLIC_DEFAULT_LANGUAGE ??
  extras.defaultLanguage ??
  "de") as string;
const REQUEST_TIMEOUT_MS = 12000;

export interface MobileDeviceRequest {
  expoPushToken: string;
  deviceName?: string;
  deviceModel?: string;
  platform?: string;
  appVersion?: string;
}

// Rich API error that keeps the HTTP status and the parsed JSON payload so callers
// can branch on structured server responses (e.g. 400 { requiresPhoto: true }).
export class ApiError extends Error {
  status: number;
  payload: Record<string, unknown> | null;

  constructor(message: string, status: number, payload: Record<string, unknown> | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {})
      },
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Sunucu zamanında yanıt vermedi. API servisinin çalıştığını kontrol edin.");
    }

    throw new Error("API servisine ulaşılamadı. Backend'i başlatıp tekrar deneyin.");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    let message = "";
    let payload: Record<string, unknown> | null = null;

    if (contentType.includes("application/json")) {
      payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const typed = payload as { detail?: string; title?: string; message?: string } | null;
      message = typed?.detail ?? typed?.title ?? typed?.message ?? "";
    } else {
      message = await response.text();
    }

    throw new ApiError(message || `Request failed: ${response.status}`, response.status, payload);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function login(email: string, password: string) {
  return apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function register(name: string, email: string, password: string) {
  return apiRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password })
  });
}

export async function me(token: string) {
  return apiRequest<AuthUser>("/auth/me", {}, token);
}

export async function refreshAuth(token: string) {
  return apiRequest<{ token: string; user: AuthUser }>("/auth/refresh", { method: "POST" }, token);
}

export async function requestTaskCompletion(token: string, taskId: string, note?: string | null, photoFileId?: string | null) {
  return apiRequest<unknown>(
    `/tasks/${taskId}/request-completion`,
    { method: "POST", body: JSON.stringify({ note: note?.trim() || null, photoFileId: photoFileId ?? null }) },
    token
  );
}

// True when the server rejected a completion request because the task requires photo proof
// (400 { requiresPhoto: true }).
export function isPhotoRequiredError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400 && Boolean(error.payload?.requiresPhoto);
}

export async function acknowledgeTask(token: string, taskId: string) {
  return apiRequest<Task>(`/tasks/${taskId}/acknowledge`, { method: "POST", body: "{}" }, token);
}

export async function snoozeTaskRequest(
  token: string,
  taskId: string,
  payload: { hours?: number; untilDate?: string; untilTime?: string; reason?: string | null }
) {
  return apiRequest<Task>(
    `/tasks/${taskId}/snooze`,
    { method: "POST", body: JSON.stringify({ ...payload, reason: payload.reason?.trim() || null }) },
    token
  );
}

// --- Settings ---

export async function getSettings(token: string) {
  return apiRequest<AppSettings>("/settings", {}, token);
}

export async function updateSettings(token: string, patch: Partial<AppSettings>) {
  return apiRequest<AppSettings>("/settings", { method: "PUT", body: JSON.stringify(patch) }, token);
}

// --- Files (multipart upload; NOT JSON, so it bypasses apiRequest) ---

export async function uploadFile(
  token: string,
  uri: string,
  mimeType: string,
  kind: string,
  relatedId?: string | null
): Promise<UploadedFile> {
  const extension = mimeType.includes("/") ? mimeType.split("/")[1] : "bin";
  const name = uri.split("/").pop() || `upload-${Date.now()}.${extension}`;
  const form = new FormData();
  // React Native FormData file object: { uri, name, type }.
  form.append("file", { uri, name, type: mimeType } as unknown as Blob);
  form.append("kind", kind);
  if (relatedId) form.append("relatedId", relatedId);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
  } catch {
    throw new Error("Dosya yüklenemedi. API servisine ulaşılamadı.");
  }

  if (!response.ok) {
    throw new ApiError(`Dosya yüklenemedi (${response.status}).`, response.status, null);
  }

  return (await response.json()) as UploadedFile;
}

// --- Shopping list ---

export async function listShoppingItems(token: string) {
  return apiRequest<ShoppingItem[]>("/shopping-items", {}, token);
}

export async function createShoppingItem(
  token: string,
  payload: { name: string; category?: string | null; chain?: string | null }
) {
  return apiRequest<ShoppingItem>(
    "/shopping-items",
    {
      method: "POST",
      body: JSON.stringify({
        name: payload.name.trim(),
        category: payload.category?.trim() || null,
        chain: payload.chain?.trim() || null
      })
    },
    token
  );
}

export async function updateShoppingItem(token: string, itemId: string, patch: Partial<ShoppingItem>) {
  return apiRequest<ShoppingItem>(`/shopping-items/${itemId}`, { method: "PUT", body: JSON.stringify(patch) }, token);
}

export async function deleteShoppingItem(token: string, itemId: string) {
  return apiRequest<void>(`/shopping-items/${itemId}`, { method: "DELETE" }, token);
}

export async function listShoppingSellers(token: string) {
  return apiRequest<ShoppingSeller[]>("/shopping-items/sellers", {}, token);
}

// --- Routes (server-tracked) ---

export interface CreateRoutePayload {
  date: string;
  stops: Array<{ companyId: string; order: number; distanceFromPrevious: string; durationFromPrevious: string }>;
  totalDistance: string;
  totalDuration: string;
  status?: string;
  source?: string;
}

export async function createRoute(token: string, payload: CreateRoutePayload) {
  return apiRequest<RoutePlan>("/routes", { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function startRoute(token: string, routeId: string) {
  return apiRequest<RoutePlan>(`/routes/${routeId}/start`, { method: "POST", body: "{}" }, token);
}

export async function completeRoute(token: string, routeId: string) {
  return apiRequest<RoutePlan>(`/routes/${routeId}/complete`, { method: "POST", body: "{}" }, token);
}

export async function markRouteStopVisited(token: string, routeId: string, stopId: string) {
  return apiRequest<RoutePlan>(`/routes/${routeId}/stops/${stopId}/visited`, { method: "POST", body: "{}" }, token);
}

// Errands along the route: given the ordered route corridor (current location first, then
// each stop), returns shops on the way that sell an open shopping-list item, nearest-to-route
// first. Returns { matches: [], note } when there are no open items.
export async function routeErrandStops(
  token: string,
  payload: { coords: Array<[number, number]>; bufferMeters?: number }
) {
  return apiRequest<{ matches: ErrandMatch[]; note?: string }>(
    "/route/errand-stops",
    {
      method: "POST",
      body: JSON.stringify({ coords: payload.coords, bufferMeters: payload.bufferMeters })
    },
    token
  );
}

// --- Reports ---

export async function getWeeklyAnalysis(token: string) {
  return apiRequest<WeeklyAnalysisReport>("/reports/weekly-analysis", {}, token);
}

// --- Late notice bot ---

export async function draftLateNotice(token: string, payload: { taskId: string; delayMinutes: number; language?: string }) {
  return apiRequest<LateNoticeDraft>("/late-notice/draft", { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function logLateNotice(token: string, payload: { taskId: string; message: string; channel: string }) {
  return apiRequest<unknown>("/late-notice/log", { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function approveTaskRequest(token: string, userId: string, taskId: string) {
  return apiRequest<unknown>(`/admin/tasks/${userId}/${taskId}/approve`, { method: "POST", body: "{}" }, token);
}

export async function rejectTaskRequest(token: string, userId: string, taskId: string, reason?: string | null) {
  return apiRequest<unknown>(
    `/admin/tasks/${userId}/${taskId}/reject`,
    { method: "POST", body: JSON.stringify({ reason: reason?.trim() || null }) },
    token
  );
}

export async function promoteUser(token: string, userId: string) {
  return apiRequest<unknown>(`/admin/users/${userId}/promote`, { method: "POST", body: "{}" }, token);
}

export async function demoteUser(token: string, userId: string) {
  return apiRequest<unknown>(`/admin/users/${userId}/demote`, { method: "POST", body: "{}" }, token);
}

export async function listAdminUsers(token: string) {
  return apiRequest<import("@/types/business").AdminUserSummary[]>("/admin/users", {}, token);
}

export async function listPendingApprovals(token: string) {
  return apiRequest<import("@/types/business").AdminTaskRow[]>("/admin/tasks/pending", {}, token);
}

export async function listAdminTasks(token: string, query: { userId?: string; companyId?: string; status?: string } = {}) {
  const params = new URLSearchParams();
  if (query.userId) params.set("userId", query.userId);
  if (query.companyId) params.set("companyId", query.companyId);
  if (query.status) params.set("status", query.status);
  const suffix = params.toString() ? `?${params}` : "";
  return apiRequest<import("@/types/business").AdminTaskRow[]>(`/admin/tasks${suffix}`, {}, token);
}

export async function listAdminCompanies(token: string) {
  return apiRequest<import("@/types/business").AdminCompanySummary[]>("/admin/companies", {}, token);
}

export async function getSnapshot(token: string) {
  const snapshot = await apiRequest<AppData>("/snapshot", {}, token);
  return normalizeSnapshot(snapshot);
}

export async function analyzeAndCommitCapture(
  token: string,
  sourceText: string,
  sourceType: "voice" | "text",
  language: string,
  companyResolution?: AiCompanyResolutionRequest,
  companyDrafts?: AiCompanyDraftRequest[]
) {
  const response = await apiRequest<AiCaptureResponse>(
    "/ai-capture/analyze-and-commit",
    {
      method: "POST",
      body: JSON.stringify({ sourceText, sourceType, language, companyResolution, companyDrafts })
    },
    token
  );

  return {
    ...response,
    snapshot: normalizeSnapshot(response.snapshot)
  };
}

// Conversational assistant grounded on the user's own data (real OpenAI call server-side).
// Throws when the backend is unreachable or the assistant is not configured (HTTP 503),
// letting the caller fall back to the offline keyword summary.
export async function askAssistant(token: string, question: string, language: string): Promise<{ answer: string }> {
  return apiRequest<{ answer: string }>(
    "/assistant/ask",
    { method: "POST", body: JSON.stringify({ question, language }) },
    token
  );
}

export async function updateTask<T extends { id: string }>(token: string, task: T) {
  return apiRequest<T>(`/tasks/${task.id}`, { method: "PUT", body: JSON.stringify(denormalizePayload(task)) }, token);
}

export async function createTask(token: string, task: Task) {
  return apiRequest<Task>("/tasks", { method: "POST", body: JSON.stringify(denormalizePayload(task)) }, token);
}

export async function deleteTask(token: string, taskId: string) {
  return apiRequest<void>(`/tasks/${taskId}`, { method: "DELETE" }, token);
}

// --- Alışkanlık (habit) hedefleri ---

// Planning aşamasındaki alışkanlığa başlangıç tarihi ver → aktif günlük hatırlatmaya döner.
export async function habitStart(
  token: string,
  taskId: string,
  payload: { startDate: string; reminderTime?: string; intervalDays?: number }
) {
  return apiRequest<Task>(
    `/tasks/${taskId}/habit-start`,
    { method: "POST", body: JSON.stringify(payload) },
    token
  );
}

// "Sonra hatırlat" → dürtüyü birkaç gün ertele (varsayılan sunucuda).
export async function habitSnooze(token: string, taskId: string, payload: { days?: number } = {}) {
  return apiRequest<{ ok: boolean; nextNudgeAt: string | null }>(
    `/tasks/${taskId}/habit-snooze`,
    { method: "POST", body: JSON.stringify(payload) },
    token
  );
}

// "Vazgeç" / "Durdur" → alışkanlığı durdur (habitStage:"stopped").
export async function habitStop(token: string, taskId: string) {
  return apiRequest<Task>(`/tasks/${taskId}/habit-stop`, { method: "POST", body: "{}" }, token);
}

export async function createCompany(token: string, company: Company) {
  return apiRequest<Company>("/companies", { method: "POST", body: JSON.stringify(denormalizePayload(company)) }, token);
}

export async function updateCompany(token: string, company: Company) {
  return apiRequest<Company>(`/companies/${company.id}`, { method: "PUT", body: JSON.stringify(denormalizePayload(company)) }, token);
}

export async function deleteCompany(token: string, companyId: string) {
  return apiRequest<void>(`/companies/${companyId}`, { method: "DELETE" }, token);
}

export async function archiveCompany(token: string, companyId: string) {
  return apiRequest<Company>(`/companies/${companyId}/archive`, { method: "POST", body: "{}" }, token);
}

export async function unarchiveCompany(token: string, companyId: string) {
  return apiRequest<Company>(`/companies/${companyId}/unarchive`, { method: "POST", body: "{}" }, token);
}

export async function createModule(token: string, module: WorkModule) {
  return apiRequest<WorkModule>("/modules", { method: "POST", body: JSON.stringify(denormalizePayload(module)) }, token);
}

export async function updateModule(token: string, module: WorkModule) {
  return apiRequest<WorkModule>(`/modules/${encodeURIComponent(module.id)}`, { method: "PUT", body: JSON.stringify(denormalizePayload(module)) }, token);
}

export async function deleteModule(token: string, moduleId: string) {
  return apiRequest<void>(`/modules/${encodeURIComponent(moduleId)}`, { method: "DELETE" }, token);
}

export async function addNote(
  token: string,
  payload: {
    companyId: string | null;
    taskId: string | null;
    content: string;
    sourceType: string;
    sourceTranscript: string | null;
  }
) {
  return apiRequest("/notes", { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function createNote(token: string, note: Note) {
  return apiRequest<Note>("/notes", { method: "POST", body: JSON.stringify(note) }, token);
}

export async function createProduct(token: string, product: Product) {
  return apiRequest<Product>("/products", { method: "POST", body: JSON.stringify(product) }, token);
}

export async function updateProduct(token: string, product: Product) {
  return apiRequest<Product>(`/products/${product.id}`, { method: "PUT", body: JSON.stringify(product) }, token);
}

export async function deleteProduct(token: string, productId: string) {
  return apiRequest<void>(`/products/${productId}`, { method: "DELETE" }, token);
}

export async function createOffer(token: string, offer: Offer) {
  return apiRequest<Offer>("/offers", { method: "POST", body: JSON.stringify(offer) }, token);
}

export async function updateOffer(token: string, offer: Offer) {
  return apiRequest<Offer>(`/offers/${offer.id}`, { method: "PUT", body: JSON.stringify(offer) }, token);
}

export async function deleteOffer(token: string, offerId: string) {
  return apiRequest<void>(`/offers/${offerId}`, { method: "DELETE" }, token);
}

export async function sendOffer(token: string, offerId: string) {
  return apiRequest<void>(`/offers/${offerId}/send`, { method: "POST" }, token);
}

export async function acceptOffer(token: string, offerId: string) {
  return apiRequest<void>(`/offers/${offerId}/accept`, { method: "POST" }, token);
}

export async function convertOfferToInvoice(token: string, offerId: string) {
  return apiRequest<void>(`/offers/${offerId}/convert-to-invoice`, { method: "POST" }, token);
}

export async function createInvoice(token: string, invoice: Invoice) {
  return apiRequest<Invoice>("/invoices", { method: "POST", body: JSON.stringify(invoice) }, token);
}

export async function updateInvoice(token: string, invoice: Invoice) {
  return apiRequest<Invoice>(`/invoices/${invoice.id}`, { method: "PUT", body: JSON.stringify(invoice) }, token);
}

export async function deleteInvoice(token: string, invoiceId: string) {
  return apiRequest<void>(`/invoices/${invoiceId}`, { method: "DELETE" }, token);
}

export async function markInvoicePaid(token: string, invoiceId: string) {
  return apiRequest<void>(`/invoices/${invoiceId}/mark-paid`, { method: "POST" }, token);
}

export async function createDocument(token: string, document: DocumentRecord) {
  return apiRequest<DocumentRecord>("/documents", { method: "POST", body: JSON.stringify(document) }, token);
}

export async function updateDocument(token: string, document: DocumentRecord) {
  return apiRequest<DocumentRecord>(`/documents/${document.id}`, { method: "PUT", body: JSON.stringify(document) }, token);
}

export async function deleteDocument(token: string, documentId: string) {
  return apiRequest<void>(`/documents/${documentId}`, { method: "DELETE" }, token);
}

export async function createReminder(token: string, reminder: Reminder) {
  return apiRequest<Reminder>("/reminders", { method: "POST", body: JSON.stringify(reminder) }, token);
}

export async function updateReminder(token: string, reminder: Reminder) {
  return apiRequest<Reminder>(`/reminders/${reminder.id}`, { method: "PUT", body: JSON.stringify(reminder) }, token);
}

export async function deleteReminder(token: string, reminderId: string) {
  return apiRequest<void>(`/reminders/${reminderId}`, { method: "DELETE" }, token);
}

export async function mobileNotificationStatus(token: string) {
  return apiRequest<MobileNotificationStatus>("/notifications/mobile/status", {}, token);
}

export async function registerMobileDevice(token: string, payload: MobileDeviceRequest) {
  return apiRequest<{ subscribed: boolean }>("/notifications/mobile/register", {
    method: "POST",
    body: JSON.stringify(payload)
  }, token);
}

export async function removeMobileDevice(token: string, expoPushToken: string) {
  return apiRequest<void>(
    "/notifications/mobile/register",
    {
      method: "DELETE",
      body: JSON.stringify({ expoPushToken })
    },
    token
  );
}

export async function applyNotificationAction(token: string, action: string) {
  return apiRequest<{ ok: boolean; taskId?: string }>("/notifications/action", {
    method: "POST",
    body: JSON.stringify({ token, action })
  });
}

export function emptyData(): AppData {
  return {
    companies: [],
    modules: [],
    tasks: [],
    notes: [],
    documents: [],
    offers: [],
    invoices: [],
    products: [],
    reminders: [],
    timeline: [],
    routes: []
  };
}

export function normalizeSnapshot(snapshot: AppData): AppData {
  return {
    companies: snapshot.companies.map((company) => ({
      ...company,
      tags: normalizeStringArray(company.tags)
    })),
    modules: snapshot.modules,
    tasks: snapshot.tasks.map((task) => ({
      ...task,
      moduleIds: normalizeStringArray(task.moduleIds)
    })),
    notes: snapshot.notes,
    documents: snapshot.documents,
    offers: snapshot.offers.map((offer) => ({
      ...offer,
      items: offer.items ?? []
    })),
    invoices: snapshot.invoices.map((invoice) => ({
      ...invoice,
      items: invoice.items ?? []
    })),
    products: snapshot.products,
    reminders: snapshot.reminders,
    timeline: snapshot.timeline,
    routes: snapshot.routes.map((route) => ({
      ...route,
      stops: route.stops ?? []
    }))
  };
}

export function denormalizePayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => denormalizePayload(item)) as T;
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "tags" || key === "moduleIds") {
        result[key] = Array.isArray(item) ? item.join(",") : item;
      } else {
        result[key] = denormalizePayload(item);
      }
    }
    return result as T;
  }

  return value;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}
