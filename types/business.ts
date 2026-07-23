export type LanguageCode = "en" | "de" | "tr" | "ar" | "fr" | "nl";

export type ThemeMode = "light" | "dark";

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
export type HabitStage = "planning" | "active" | "stopped" | "";
export type SourceType = "voice" | "text" | "pdf" | "image" | "manual";
export type OfferStatus =
  | "draft"
  | "prepared"
  | "sent"
  | "followUpNeeded"
  | "accepted"
  | "rejected"
  | "convertedToInvoice";
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
  createdAt: string;
  updatedAt: string;
  formattedAddress?: string | null;
  addressVerified?: boolean;
  addressVerifiedAt?: string | null;
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
  // Habit ("alışkanlık") fields — populated only when the AI capture flow
  // detects a personal goal. Regular tasks leave these undefined.
  isHabit?: boolean;
  habitStage?: HabitStage;
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
  fileId?: string | null;
  fieldsJson?: string | null;
}

export interface OfferItem {
  id: string;
  productName: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  imageUrl?: string | null;
}

export interface Offer {
  id: string;
  companyId: string;
  offerNumber: string;
  offerDate: string;
  title: string;
  status: OfferStatus;
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
}

export interface ParsedBusinessInput {
  detectedLanguage: LanguageCode;
  company: {
    name: string | null;
    confidence: number;
    shouldCreateIfMissing: boolean;
  };
  modules: Array<{
    name: string;
    confidence: number;
    shouldCreateIfMissing: boolean;
  }>;
  tasks: Array<{
    title: string;
    type: string;
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
  companyResolution?: {
    detectedName: string;
    message: string;
    candidates: Array<{
      id: string;
      name: string;
      address: string;
      taskCount: number;
      createdAt: string;
      latitude?: number | null;
      longitude?: number | null;
    }>;
  } | null;
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

export interface AiCompanyDraftRequest {
  detectedName?: string | null;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
}

export interface UserSettings {
  id: string;
  email: string;
  name: string;
  companyName: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyTaxId: string | null;
  companyIban: string | null;
  paymentTerms: string | null;
  defaultReminderLeadMinutes: number | null;
  homeLatitude: number | null;
  homeLongitude: number | null;
  homeAddress: string | null;
  dailyDigestEnabled: boolean;
  weeklyDigestEnabled: boolean;
}

export type ShoppingItemStatus = "open" | "done";

export interface ShoppingItem {
  id: string;
  name: string;
  category: string | null;
  // Optional store chain (e.g. "BIM", "Migros"). When set, the route errand
  // match narrows to shops carrying that chain name.
  chain?: string | null;
  status: ShoppingItemStatus;
  createdAt: string;
  completedAt: string | null;
}

// A shop found along the active route that can fulfil an open shopping item.
export interface ErrandMatch {
  itemId: string;
  itemName: string;
  shopName: string;
  category: string;
  chain: string;
  latitude: number;
  longitude: number;
  distanceToRouteMeters: number;
}

export interface RouteErrandResponse {
  matches: ErrandMatch[];
  note?: string;
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
