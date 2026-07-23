export type LanguageCode = "en" | "de" | "tr" | "ar" | "fr" | "nl";

export type CompanyStatus =
  | "new"
  | "firstContact"
  | "interested"
  | "offerPrepared"
  | "offerSent"
  | "followUp"
  | "accepted"
  | "invoiceNeeded"
  | "waitingPayment"
  | "completed"
  | "lost";

export type ModuleType =
  | "todo"
  | "visits"
  | "calls"
  | "offers"
  | "invoices"
  | "installation"
  | "removal"
  | "repair"
  | "support"
  | "payments"
  | "projects"
  | "delivery"
  | "measurements"
  | "custom";

export type TaskStatus = "open" | "done" | "snoozed" | "overdue" | "pending_approval";
export type TaskPriority = "low" | "medium" | "high";
export type SourceType = "voice" | "text" | "pdf" | "image" | "manual";
export type OfferStatus =
  | "draft"
  | "prepared"
  | "sent"
  | "followUpNeeded"
  | "accepted"
  | "rejected"
  | "convertedToInvoice";
export type OfferKind = "offer" | "package";
export type InvoiceStatus = "unpaid" | "partiallyPaid" | "paid" | "overdue";
export type ReminderStatus = "active" | "paused" | "completed";

export interface Company {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  contactPerson: string;
  latitude: number;
  longitude: number;
  status: CompanyStatus;
  tags: string[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkModule {
  id: string;
  name: string;
  type: ModuleType;
  createdByAI: boolean;
  isPinnedToSidebar: boolean;
  taskCount: number;
  createdAt: string;
}

export interface Task {
  id: string;
  companyId: string | null;
  contactPersonName: string | null;
  title: string;
  description: string;
  type: ModuleType;
  moduleIds: string[];
  dueDate: string | null;
  dueTime: string | null;
  timeWindow: string | null;
  reminderInterval: string | null;
  repeatUntilDone: boolean;
  status: TaskStatus;
  priority: TaskPriority;
  notificationsEnabled?: boolean;
  nextAlertAt?: string | null;
  alertCount?: number;
  createdAt: string;
  completedAt: string | null;
  completionRequestedAt?: string | null;
  completionRequestedNote?: string | null;
  lastRejectedAt?: string | null;
  lastRejectionReason?: string | null;
  assignedByUserId?: string | null;
  acknowledgedAt?: string | null;
  requirePhotoProof?: boolean;
  completionPhotoId?: string | null;
  delayReason?: string | null;
  // --- Alışkanlık (habit) alanları ---
  // AI capture bir kişisel hedefi (örn. "kitap okumak") yakaladığında bu görev
  // isHabit:true, habitStage:"planning" olarak, tarihsiz oluşturulur.
  isHabit?: boolean;
  habitStage?: "planning" | "active" | "stopped" | "";
  habitStartDate?: string | null;
  nudgeIntervalDays?: number;
  habitReminderTime?: string;
  nextNudgeAt?: string | null;
}

export interface Note {
  id: string;
  companyId: string | null;
  taskId: string | null;
  content: string;
  sourceType: SourceType;
  sourceTranscript: string | null;
  createdAt: string;
}

export interface DocumentRecord {
  id: string;
  companyId: string | null;
  fileName: string;
  fileType: string;
  documentType: string;
  extractedText: string;
  summary: string;
  uploadedAt: string;
}

export interface OfferItem {
  id: string;
  productName: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Offer {
  id: string;
  companyId: string;
  offerNumber: string;
  offerDate: string;
  title: string;
  status: OfferStatus;
  kind: OfferKind;
  items: OfferItem[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  currency: string;
  validityDays: number;
  notes: string;
  pdfUrl: string | null;
}

export interface Invoice {
  id: string;
  companyId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  items: OfferItem[];
  subtotal: number;
  vatRate: number;
  total: number;
  paidAt: string | null;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  costPrice: number;
  sellingPrice: number;
  minimumPrice: number;
  currency: string;
  margin: number;
  updatedAt: string;
}

export interface Reminder {
  id: string;
  taskId: string;
  startTime: string;
  repeatInterval: string;
  activeUntilDone: boolean;
  status: ReminderStatus;
  notificationsEnabled?: boolean;
}

export interface TimelineEntry {
  id: string;
  companyId: string;
  type: string;
  title: string;
  description: string;
  date: string;
  relatedId: string | null;
}

export interface RouteStop {
  id: string;
  companyId: string;
  order: number;
  distanceFromPrevious: string;
  durationFromPrevious: string;
}

export interface RoutePlan {
  id: string;
  date: string;
  stops: RouteStop[];
  totalDistance: string;
  totalDuration: string;
  status?: string;
  source?: string;
}

// --- Settings ---
export interface AppSettings {
  id: string;
  name: string;
  email: string;
  defaultReminderLeadMinutes: number;
  homeLatitude: number | null;
  homeLongitude: number | null;
  homeAddress: string | null;
  dailyDigestEnabled: boolean;
  weeklyDigestEnabled: boolean;
  companyName: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyTaxId: string | null;
  companyIban: string | null;
  paymentTerms: string | null;
}

// --- Files ---
export interface UploadedFile {
  id: string;
  fileName: string;
  size: number;
  url: string;
}

// --- Shopping list ---
export interface ShoppingItem {
  id: string;
  name: string;
  category: string | null;
  // Optional store chain the item belongs to (e.g. "BIM"). Feeds the along-the-route
  // errand matcher so it can target that chain's shops.
  chain?: string | null;
  status: string;
  createdAt?: string;
}

// A shop found ALONG the active route that sells an open shopping-list errand. Returned by
// POST /route/errand-stops, nearest-to-route first.
export interface ErrandMatch {
  itemId: string;
  itemName: string;
  shopName: string;
  category: string | null;
  chain: string | null;
  latitude: number;
  longitude: number;
  distanceToRouteMeters: number;
}

export interface ShoppingSeller {
  itemId: string;
  itemName: string;
  companyId: string;
  companyName: string;
  latitude: number;
  longitude: number;
  address: string;
}

// --- Weekly analysis (server report) ---
export interface WeeklyOverdueTask {
  id: string;
  title: string;
  company: string | null;
  dueDate: string | null;
  dueTime: string | null;
  delayHours: number;
  delayReason: string | null;
  recurring: boolean;
}

export interface WeeklyAnalysisReport {
  totals: {
    completedTasks?: number;
    overdueTasks?: number;
    totalTasks?: number;
    totalVisits?: number;
    totalDistance?: string | number;
    totalDuration?: string | number;
    [key: string]: unknown;
  };
  routes: RoutePlan[];
  visitsByCompany: Array<{ companyId?: string; companyName?: string; company?: string; visits?: number; count?: number }>;
  overdueTasks: WeeklyOverdueTask[];
}

// --- Late notice ---
export interface LateNoticeDraft {
  message: string;
  companyName: string;
  companyPhone: string;
}

export interface AppData {
  companies: Company[];
  modules: WorkModule[];
  tasks: Task[];
  notes: Note[];
  documents: DocumentRecord[];
  offers: Offer[];
  invoices: Invoice[];
  products: Product[];
  reminders: Reminder[];
  timeline: TimelineEntry[];
  routes: RoutePlan[];
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
}

export interface AdminCompanySummary {
  id: string;
  name: string;
  address: string;
  userId: string;
}

export interface AiCaptureAnalysis {
  detectedLanguage: LanguageCode;
  company: {
    name: string | null;
    confidence: number;
    shouldCreateIfMissing: boolean;
  };
  modules: Array<{
    name: string;
    type: ModuleType;
    confidence: number;
    shouldCreateIfMissing: boolean;
  }>;
  tasks: Array<{
    title: string;
    description: string;
    type: ModuleType;
    companyName?: string | null;
    contactPersonName?: string | null;
    personConfidence?: number;
    dueDate: string | null;
    dueTime: string | null;
    timeWindow: string | null;
    priority: TaskPriority;
    reminderRule: string | null;
  }>;
  notes: string[];
  offerData: {
    detected: boolean;
    products: string[];
    prices: number[];
    currency: string;
  };
  documentData: {
    detected: boolean;
    type: string | null;
  };
}

export interface AiCompanyResolutionRequest {
  existingCompanyId?: string | null;
  createSeparateCompany?: boolean;
}

export interface AiCompanyDraftRequest {
  detectedName?: string | null;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
}

export interface AiCompanyResolutionCandidate {
  id: string;
  name: string;
  address: string;
  taskCount: number;
  createdAt: string;
  latitude: number | null;
  longitude: number | null;
  distanceMeters?: number | null;
}

export interface AiCompanyResolutionPrompt {
  detectedName: string;
  candidates: AiCompanyResolutionCandidate[];
  message: string;
}

export interface AiCaptureResponse {
  snapshot: AppData;
  analysis: AiCaptureAnalysis;
  created: {
    companyId: string | null;
    taskIds: string[];
    moduleIds: string[];
    reminderIds: string[];
    offerId?: string | null;
    invoiceId?: string | null;
  };
  companyResolution?: AiCompanyResolutionPrompt | null;
  requiresCompanyResolution?: boolean;
  addressResolution?: {
    detectedName: string;
    message: string;
  } | null;
  addressResolutions?: Array<{
    detectedName: string;
    message: string;
  }> | null;
  requiresAddressResolution?: boolean;
}

export interface MobileNotificationStatus {
  subscribed: boolean;
  deviceCount: number;
}

export interface NotificationPermissionState {
  canAskAgain: boolean;
  granted: boolean;
  status: string;
}

export interface UserLocationCoordinates {
  latitude: number;
  longitude: number;
}

export interface UserLocationState {
  canAskAgain: boolean;
  granted: boolean;
  status: string;
  coords: UserLocationCoordinates | null;
  updatedAt: string | null;
  error: string | null;
}
