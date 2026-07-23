import type {
  Company,
  DocumentRecord,
  Invoice,
  Note,
  Offer,
  OfferItem,
  Product,
  Reminder,
  SourceType,
  Task,
  WorkModule
} from "@/types/business";

export function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeCompany(input: Partial<Company>): Company {
  const name = input.name?.trim() ?? "";
  const now = new Date().toISOString();
  return {
    id: input.id ?? createId("company"),
    name,
    address: input.address ?? "",
    phone: input.phone ?? "",
    email: input.email ?? "",
    contactPerson: input.contactPerson ?? "",
    latitude: input.latitude ?? 0,
    longitude: input.longitude ?? 0,
    status: input.status ?? "new",
    tags: input.tags ?? [],
    archivedAt: input.archivedAt ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: now
  };
}

export function normalizeModule(input: Partial<WorkModule>): WorkModule {
  const name = input.name?.trim() || "Custom";
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

export function normalizeTask(input: Partial<Task>, modules: WorkModule[]): Task {
  const fallbackModule = modules.find((module) => module.type === "todo")?.id ?? "module-todo";
  return {
    id: input.id ?? createId("task"),
    companyId: input.companyId ?? null,
    contactPersonName: input.contactPersonName ?? null,
    title: input.title?.trim() ?? "",
    description: input.description?.trim() ?? "",
    type: input.type ?? "todo",
    moduleIds: input.moduleIds?.length ? input.moduleIds : [fallbackModule],
    // dueDate anahtarı hiç gönderilmediyse bugüne varsayılır (eski davranış);
    // ancak açıkça null gönderilirse "zamansız görev" olarak null kalır — bugüne
    // çevrilmez. Böylece tarihsiz görevler hatırlatma/gecikme tetiklemez.
    dueDate: "dueDate" in input ? input.dueDate ?? null : isoDate(0),
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

export function normalizeNote(input: Partial<Note>): Note {
  return {
    id: input.id ?? createId("note"),
    companyId: input.companyId ?? null,
    taskId: input.taskId ?? null,
    content: input.content?.trim() ?? "",
    sourceType: input.sourceType ?? ("manual" as SourceType),
    sourceTranscript: input.sourceTranscript ?? null,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

export function normalizeProduct(input: Partial<Product>): Product {
  const costPrice = input.costPrice ?? 0;
  const sellingPrice = input.sellingPrice ?? 0;
  const minimumPrice = input.minimumPrice ?? sellingPrice;
  return {
    id: input.id ?? createId("product"),
    name: input.name?.trim() ?? "",
    category: input.category?.trim() || "General",
    description: input.description?.trim() ?? "",
    costPrice,
    sellingPrice,
    minimumPrice,
    currency: input.currency ?? "EUR",
    margin: input.margin ?? (sellingPrice > 0 ? (sellingPrice - costPrice) / sellingPrice : 0),
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
}

export function normalizeOfferItem(input: Partial<OfferItem>): OfferItem {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 0;
  return {
    id: input.id ?? createId("offer-item"),
    productName: input.productName?.trim() || "Service",
    description: input.description?.trim() ?? "",
    quantity,
    unitPrice,
    totalPrice: input.totalPrice ?? quantity * unitPrice
  };
}

export function normalizeOffer(input: Partial<Offer>): Offer {
  const items = input.items?.length ? input.items.map((item) => normalizeOfferItem(item)) : [normalizeOfferItem({})];
  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const vatRate = input.vatRate ?? 0.19;
  const vatAmount = input.vatAmount ?? subtotal * vatRate;
  return {
    id: input.id ?? createId("offer"),
    companyId: input.companyId ?? "",
    offerNumber: input.offerNumber ?? `AN-${Date.now()}`,
    offerDate: input.offerDate ?? isoDate(0),
    title: input.title?.trim() ?? "",
    status: input.status ?? "draft",
    kind: input.kind ?? "offer",
    items,
    subtotal,
    vatRate,
    vatAmount,
    total: input.total ?? subtotal + vatAmount,
    currency: input.currency ?? "EUR",
    validityDays: input.validityDays ?? 14,
    notes: input.notes?.trim() ?? "",
    pdfUrl: input.pdfUrl ?? null
  };
}

export function normalizeInvoice(input: Partial<Invoice>): Invoice {
  const items = input.items?.length ? input.items.map((item) => normalizeOfferItem(item)) : [normalizeOfferItem({})];
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
    total: input.total ?? subtotal + subtotal * vatRate,
    paidAt: input.paidAt ?? null
  };
}

export function normalizeDocument(input: Partial<DocumentRecord>): DocumentRecord {
  return {
    id: input.id ?? createId("doc"),
    companyId: input.companyId ?? null,
    fileName: input.fileName?.trim() ?? "",
    fileType: input.fileType ?? "application/pdf",
    documentType: input.documentType?.trim() || "PDF",
    extractedText: input.extractedText?.trim() ?? "",
    summary: input.summary?.trim() ?? "",
    uploadedAt: input.uploadedAt ?? new Date().toISOString()
  };
}

export function normalizeReminder(input: Partial<Reminder>): Reminder {
  return {
    id: input.id ?? createId("reminder"),
    taskId: input.taskId ?? "",
    startTime: input.startTime ?? new Date().toISOString(),
    repeatInterval: input.repeatInterval?.trim() || "Daily",
    activeUntilDone: input.activeUntilDone ?? true,
    status: input.status ?? "active",
    notificationsEnabled: input.notificationsEnabled ?? true
  };
}
