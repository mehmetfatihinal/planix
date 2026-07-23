import type {
  AppData,
  Company,
  DocumentRecord,
  LanguageCode,
  Offer,
  RouteErrandResponse,
  ShoppingItem,
  Task,
  UserSettings
} from "@/types/business";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

const AUTH_TOKEN_STORAGE_KEY = "arx-task:auth-token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isAdmin?: boolean;
  isSystemAdmin?: boolean;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  isSystemAdmin: boolean;
  createdAt: string;
  taskCounts: { open: number; pending: number; done: number; snoozed: number };
}

export interface AdminTaskRow {
  task: {
    id: string;
    userId: string;
    companyId: string | null;
    title: string;
    description: string;
    status: string;
    priority: string;
    dueDate: string | null;
    dueTime: string | null;
    createdAt: string;
    completedAt: string | null;
    completionRequestedAt?: string | null;
    completionRequestedNote?: string | null;
  };
  user: { id: string; name: string; email: string } | null;
  company: { id: string; name: string; address: string } | null;
  completionPhotoUrl?: string | null;
}

export interface AdminCompanySummary {
  id: string;
  name: string;
  address: string;
  userId: string;
}

export interface AssignTaskInput {
  targetUserId: string;
  title: string;
  description?: string | null;
  companyId?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: string | null;
  type?: string | null;
  moduleIds?: string[] | null;
  requirePhotoProof?: boolean;
}

export interface SnoozeTaskInput {
  hours?: number;
  untilDate?: string;
  untilTime?: string;
  reason?: string;
}

export interface ReportOverdueItem {
  id: string;
  title: string;
  companyId: string | null;
  dueDate: string | null;
  dueTime: string | null;
  delayHours: number;
  delayReason: string | null;
  recurring: boolean;
}

export interface ReportRecord {
  id: string;
  kind: "daily" | "weekly";
  date: string;
  payload: {
    overdue: ReportOverdueItem[];
    recurring: ReportOverdueItem[];
    weeklyVisits?: number;
  };
  createdAt: string;
}

export interface WeeklyAnalysisResponse {
  weekStart: string;
  weekEnd: string;
  totals: {
    completedTasks: number;
    overdueTasks: number;
    recurringOpenTasks: number;
    visits: number;
    routes: number;
    acceptedOffers: number;
    openOffers: number;
    unpaidInvoiceTotal: number;
    paidThisWeek: number;
  };
  routes: Array<{
    id: string;
    date: string;
    status: string;
    source: string;
    stops: Array<{ companyId: string; companyName: string; visitedAt: string | null }>;
  }>;
  visitsByCompany: Array<{ companyId: string; companyName: string; count: number }>;
  overdueTasks: Array<{
    id: string;
    title: string;
    company: string | null;
    dueDate: string | null;
    dueTime: string | null;
    delayHours: number;
    delayReason: string | null;
    recurring: boolean;
  }>;
  visitLog: Array<{ id: string; companyId: string | null; companyName?: string | null; visitedAt?: string | null; date?: string | null }>;
}

export interface OfferFromUrlResponse {
  offer: Offer;
  products: Array<{ name: string; price: number; currency: string; imageUrl: string | null }>;
}

export interface DocumentScanField {
  key?: string;
  label: string;
  value?: string | null;
  suggestedValue?: string | null;
}

export interface DocumentScanResponse {
  document: DocumentRecord;
  fields: DocumentScanField[];
  ocrAvailable: boolean;
}

export interface LateNoticeDraftResponse {
  message: string;
  delayMinutes: number;
  companyName: string | null;
  companyPhone: string | null;
  requiresApproval: boolean;
}

export interface UploadedFileInfo {
  id: string;
  fileName: string;
  size: number;
  url: string;
}

export class RequestCompletionPhotoRequiredError extends Error {
  requiresPhoto = true as const;
  constructor(message: string) {
    super(message);
    this.name = "RequestCompletionPhotoRequiredError";
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    let message = "";

    if (contentType.includes("application/json")) {
      const payload = await response.json().catch(() => null) as
        | { detail?: string; title?: string; message?: string }
        | null;
      message = payload?.detail ?? payload?.title ?? payload?.message ?? "";
    } else {
      message = await response.text();
    }

    throw new Error(message || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
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

export function defaultLanguage(): LanguageCode {
  return "de";
}

/** Fetches a protected binary resource (PDF, image, ...) with the stored JWT. */
export async function apiBlob(path: string): Promise<Blob> {
  const token = getStoredToken();
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.blob();
}

/** Downloads a protected PDF/binary endpoint via an object URL + <a download>. */
export async function downloadPdf(path: string, filename: string): Promise<void> {
  const blob = await apiBlob(path);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/** Uploads a file via multipart form data. Content-Type is set by the browser. */
export async function uploadFile(file: File, kind: string, relatedId?: string): Promise<UploadedFileInfo> {
  const token = getStoredToken();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("kind", kind);
  if (relatedId) formData.append("relatedId", relatedId);

  const response = await fetch(`${API_URL}/files`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  return (await response.json()) as UploadedFileInfo;
}

export function getSettings(token: string) {
  return apiRequest<UserSettings>("/settings", {}, token);
}

export function updateSettings(token: string, input: Partial<UserSettings>) {
  return apiRequest<UserSettings>("/settings", { method: "PUT", body: JSON.stringify(input) }, token);
}

export function assignAdminTask(token: string, input: AssignTaskInput) {
  return apiRequest<Task>("/admin/tasks/assign", { method: "POST", body: JSON.stringify(input) }, token);
}

export function acknowledgeTaskRequest(token: string, taskId: string) {
  return apiRequest<Task>(`/tasks/${taskId}/acknowledge`, { method: "POST", body: "{}" }, token);
}

export function snoozeTaskRequest(token: string, taskId: string, input: SnoozeTaskInput) {
  return apiRequest<Task>(`/tasks/${taskId}/snooze`, { method: "POST", body: JSON.stringify(input) }, token);
}

/**
 * Requests completion approval. Throws RequestCompletionPhotoRequiredError when the
 * task requires a photo proof and no photoFileId was supplied (HTTP 400 + requiresPhoto).
 */
export async function requestTaskCompletion(
  token: string,
  taskId: string,
  input: { note?: string | null; photoFileId?: string | null }
): Promise<void> {
  const response = await fetch(`${API_URL}/tasks/${taskId}/request-completion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ note: input.note ?? null, photoFileId: input.photoFileId ?? null })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string; requiresPhoto?: boolean } | null;
    if (response.status === 400 && payload?.requiresPhoto) {
      throw new RequestCompletionPhotoRequiredError(payload.message ?? "Photo proof required.");
    }
    throw new Error(payload?.message ?? `Request failed: ${response.status}`);
  }
}

export function habitStart(
  token: string,
  taskId: string,
  input: { startDate: string; reminderTime?: string; intervalDays?: number }
) {
  return apiRequest<Task>(`/tasks/${taskId}/habit-start`, { method: "POST", body: JSON.stringify(input) }, token);
}

export function habitSnooze(token: string, taskId: string, input: { days?: number } = {}) {
  return apiRequest<{ ok: boolean; nextNudgeAt: string | null }>(
    `/tasks/${taskId}/habit-snooze`,
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}

export function habitStop(token: string, taskId: string) {
  return apiRequest<Task>(`/tasks/${taskId}/habit-stop`, { method: "POST", body: "{}" }, token);
}

export function verifyCompanyAddressRequest(token: string, companyId: string) {
  return apiRequest<{ company: Company; verified: boolean }>(
    `/companies/${companyId}/verify-address`,
    { method: "POST", body: "{}" },
    token
  );
}

export function geocodeMissingCompaniesRequest(token: string) {
  return apiRequest<{ checkedCount: number; verifiedCount: number }>(
    "/companies/geocode-missing",
    { method: "POST", body: "{}" },
    token
  );
}

export function getReports(token: string, kind?: "daily" | "weekly", limit?: number) {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (typeof limit === "number") params.set("limit", String(limit));
  const query = params.toString();
  return apiRequest<ReportRecord[]>(`/reports${query ? `?${query}` : ""}`, {}, token);
}

export function getWeeklyAnalysis(token: string, weekStart?: string) {
  const query = weekStart ? `?weekStart=${weekStart}` : "";
  return apiRequest<WeeklyAnalysisResponse>(`/reports/weekly-analysis${query}`, {}, token);
}

export function getShoppingItems(token: string) {
  return apiRequest<ShoppingItem[]>("/shopping-items", {}, token);
}

export function createShoppingItemRequest(
  token: string,
  input: { name: string; category?: string | null; chain?: string | null }
) {
  return apiRequest<ShoppingItem>("/shopping-items", { method: "POST", body: JSON.stringify(input) }, token);
}

export function updateShoppingItemRequest(token: string, id: string, input: Partial<ShoppingItem>) {
  return apiRequest<ShoppingItem>(`/shopping-items/${id}`, { method: "PUT", body: JSON.stringify(input) }, token);
}

export function deleteShoppingItemRequest(token: string, id: string) {
  return apiRequest<void>(`/shopping-items/${id}`, { method: "DELETE" }, token);
}

/**
 * Finds shops along the active route corridor that can fulfil open shopping
 * items. `coords` are ordered [lat, lng] route points (current location first
 * when available, then each stop). Returns matches nearest-to-route first, or
 * `{ matches: [], note }` when there are no open shopping items.
 */
export function routeErrandStops(
  token: string,
  input: { coords: Array<[number, number]>; bufferMeters?: number }
) {
  return apiRequest<RouteErrandResponse>("/route/errand-stops", { method: "POST", body: JSON.stringify(input) }, token);
}

export function offerFromUrlRequest(token: string, input: { url: string; companyId?: string | null; title?: string | null }) {
  return apiRequest<OfferFromUrlResponse>("/offers/from-url", { method: "POST", body: JSON.stringify(input) }, token);
}

export async function scanDocumentRequest(
  token: string,
  file: File,
  options?: { companyId?: string | null; documentType?: string | null; language?: string | null }
): Promise<DocumentScanResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (options?.companyId) formData.append("companyId", options.companyId);
  if (options?.documentType) formData.append("documentType", options.documentType);
  if (options?.language) formData.append("language", options.language);

  const response = await fetch(`${API_URL}/documents/scan`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? `Scan failed: ${response.status}`);
  }

  return (await response.json()) as DocumentScanResponse;
}

export function lateNoticeDraftRequest(
  token: string,
  input: { taskId: string; delayMinutes: number; language?: string | null }
) {
  return apiRequest<LateNoticeDraftResponse>("/late-notice/draft", { method: "POST", body: JSON.stringify(input) }, token);
}

export function lateNoticeLogRequest(token: string, input: { taskId: string; message: string; channel: string }) {
  return apiRequest<void>("/late-notice/log", { method: "POST", body: JSON.stringify(input) }, token);
}

export function assistantAskRequest(token: string, input: { question: string; language: LanguageCode }) {
  return apiRequest<{ answer: string }>("/assistant/ask", { method: "POST", body: JSON.stringify(input) }, token);
}

export function createVisitRequest(token: string, input: { companyId: string; note?: string | null; visitedAt?: string | null }) {
  return apiRequest<unknown>("/visits", { method: "POST", body: JSON.stringify(input) }, token);
}

export function getVisitsRequest(token: string, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return apiRequest<unknown[]>(`/visits${query ? `?${query}` : ""}`, {}, token);
}

export function startRouteRequest(token: string, routeId: string) {
  return apiRequest<unknown>(`/routes/${routeId}/start`, { method: "POST", body: "{}" }, token);
}

export function completeRouteRequest(token: string, routeId: string) {
  return apiRequest<unknown>(`/routes/${routeId}/complete`, { method: "POST", body: "{}" }, token);
}

export function markRouteStopVisitedRequest(token: string, routeId: string, stopId: string) {
  return apiRequest<unknown>(`/routes/${routeId}/stops/${stopId}/visited`, { method: "POST", body: "{}" }, token);
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
