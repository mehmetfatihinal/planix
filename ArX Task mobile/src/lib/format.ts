import type { Company, CompanyStatus, InvoiceStatus, OfferStatus, Task, TaskStatus, WorkModule } from "@/types/business";

export function parseTaskDueAt(task: Pick<Task, "dueDate" | "dueTime">) {
  if (!task.dueDate || !task.dueTime) return null;
  const date = new Date(`${task.dueDate}T${task.dueTime}:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function getEffectiveTaskStatus(task: Pick<Task, "status" | "dueDate" | "dueTime">, now = new Date()): TaskStatus {
  if (task.status === "done") {
    return "done";
  }

  const dueAt = parseTaskDueAt(task);
  if (dueAt && dueAt.getTime() < now.getTime()) {
    return "overdue";
  }

  return task.status;
}

export function isTaskOverdue(task: Pick<Task, "status" | "dueDate" | "dueTime">, now = new Date()) {
  return getEffectiveTaskStatus(task, now) === "overdue";
}

export function isTaskOpen(task: Pick<Task, "status" | "dueDate" | "dueTime">, now = new Date()) {
  const status = getEffectiveTaskStatus(task, now);
  return status !== "done" && status !== "overdue";
}

function localDateKey(date: Date) {
  // YYYY-MM-DD in the device's local timezone (the same format the AI/backend
  // stores `dueDate` in), so day-equality comparisons stay timezone-safe.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Bugün ekranı için "bu görev bugüne mi ait?" kontrolü.
// dueDate bugünse → evet; dueDate başka gün → hayır.
// Zamansız (tarihsiz) görevler bugüne akmaz; onlar "Görevler > Zamansız
// Görevler" bölümünde listelenir, Bugün ekranı yalnızca bugüne tarihli
// görevleri gösterir. Geciken görevleri burada eklemiyoruz çünkü "Geciken"
// sekmesi onları ayrıca topluyor.
export function isTaskOnToday(task: Pick<Task, "dueDate">, now = new Date()) {
  if (!task.dueDate) return false;
  return task.dueDate === localDateKey(now);
}

// Zamansız (tarihsiz) görev: tarih atanmamış ve henüz tamamlanmamış görev.
// Bunlar hatırlatma tetiklemez ve gecikmiş olarak görünmez; sadece listelenir.
export function isUndatedTask(task: Pick<Task, "dueDate" | "status">) {
  return !task.dueDate && task.status !== "done";
}

export function isTaskCompletedOn(task: Pick<Task, "status" | "completedAt">, day: Date) {
  if (task.status !== "done" || !task.completedAt) return false;
  const completed = new Date(task.completedAt);
  if (Number.isNaN(completed.getTime())) return false;
  return localDateKey(completed) === localDateKey(day);
}

export function formatDateLabel(value: string | null, language = "tr") {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(mapLocale(language), {
    day: "2-digit",
    month: "short",
    weekday: "short"
  }).format(date);
}

export function formatCurrency(value: number, language = "tr") {
  return new Intl.NumberFormat(mapLocale(language), {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatNumber(value: number, language = "tr", maximumFractionDigits = 0) {
  return new Intl.NumberFormat(mapLocale(language), { maximumFractionDigits }).format(value);
}

export function formatPercent(value: number, language = "tr") {
  return new Intl.NumberFormat(mapLocale(language), {
    style: "percent",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatDateTimeLabel(value: string | null, language = "tr") {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(mapLocale(language), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function localizeTaskTypeLabel(value: string, language = "tr") {
  const key = normalizeLookup(value);
  const labels: Record<string, Record<string, string>> = {
    visits: {
      tr: "Ziyaret",
      en: "Visits",
      de: "Besuche",
      fr: "Visites",
      nl: "Bezoeken",
      ar: "زيارات"
    },
    calls: {
      tr: "Aramalar",
      en: "Calls",
      de: "Anrufe",
      fr: "Appels",
      nl: "Oproepen",
      ar: "مكالمات"
    },
    offers: {
      tr: "Teklifler",
      en: "Offers",
      de: "Angebote",
      fr: "Offres",
      nl: "Offertes",
      ar: "العروض"
    },
    invoices: {
      tr: "Faturalar",
      en: "Invoices",
      de: "Rechnungen",
      fr: "Factures",
      nl: "Facturen",
      ar: "الفواتير"
    },
    installation: {
      tr: "Kurulum",
      en: "Installation",
      de: "Installation",
      fr: "Installation",
      nl: "Installatie",
      ar: "تركيب"
    },
    removal: {
      tr: "Sokum",
      en: "Removal",
      de: "Abbau",
      fr: "Retrait",
      nl: "Verwijdering",
      ar: "إزالة"
    },
    repair: {
      tr: "Tamir",
      en: "Repair",
      de: "Reparatur",
      fr: "Reparation",
      nl: "Reparatie",
      ar: "إصلاح"
    },
    support: {
      tr: "Destek",
      en: "Support",
      de: "Support",
      fr: "Support",
      nl: "Support",
      ar: "دعم"
    },
    payments: {
      tr: "Odemeler",
      en: "Payments",
      de: "Zahlungen",
      fr: "Paiements",
      nl: "Betalingen",
      ar: "المدفوعات"
    },
    projects: {
      tr: "Projeler",
      en: "Projects",
      de: "Projekte",
      fr: "Projets",
      nl: "Projecten",
      ar: "المشاريع"
    },
    delivery: {
      tr: "Teslimat",
      en: "Delivery",
      de: "Lieferung",
      fr: "Livraison",
      nl: "Levering",
      ar: "التسليم"
    },
    measurements: {
      tr: "Olcumler",
      en: "Measurements",
      de: "Aufmaße",
      fr: "Mesures",
      nl: "Metingen",
      ar: "القياسات"
    },
    todo: {
      tr: "Yapilacak",
      en: "To do",
      de: "To-do",
      fr: "A faire",
      nl: "Te doen",
      ar: "مهام"
    },
    custom: {
      tr: "Ozel",
      en: "Custom",
      de: "Individuell",
      fr: "Personnalise",
      nl: "Aangepast",
      ar: "مخصص"
    }
  };

  return labels[key]?.[language] ?? value;
}

export function localizeReminderLabel(value: string | null, language = "tr") {
  if (!value) {
    return fallbackByLanguage(language, "Hatirlatma yok", "No reminder", "Keine Erinnerung", "Aucun rappel", "Geen herinnering", "لا يوجد تذكير");
  }

  const trimmed = value.trim();
  const normalized = normalizeLookup(trimmed);

  if (normalized === "start 5 hours before due time, repeat every hour until due time or done") {
    return fallbackByLanguage(
      language,
      "Vade saatinden 5 saat once basla, gorev bitene kadar her saat hatirlat",
      "Start 5 hours before due time, repeat hourly until done",
      "5 Stunden vorher starten, bis erledigt jede Stunde erinnern",
      "Commencer 5 heures avant, rappeler chaque heure jusqu'a la fin",
      "Begin 5 uur van tevoren, herinner elk uur tot voltooid",
      "ابدأ قبل 5 ساعات وذكّر كل ساعة حتى الاكتمال"
    );
  }

  const intervalMatch = trimmed.match(/Remind every hour from\s+(\d{2}:\d{2})\s+until\s+(\d{2}:\d{2})\s+or done/i);
  if (intervalMatch) {
    const [, start, end] = intervalMatch;
    return fallbackByLanguage(
      language,
      `${start}'dan ${end}'e kadar her saat hatirlat`,
      `Remind every hour from ${start} until ${end}`,
      `Erinnere stündlich von ${start} bis ${end}`,
      `Rappeler chaque heure de ${start} a ${end}`,
      `Herinner elk uur van ${start} tot ${end}`,
      `ذكّر كل ساعة من ${start} حتى ${end}`
    );
  }

  return trimmed;
}

export function groupTasks(tasks: Task[], modules: WorkModule[]) {
  const groups = new Map<string, Task[]>();
  tasks.forEach((task) => {
    const key = modules.find((module) => task.moduleIds.includes(module.id))?.name ?? "Diğer";
    groups.set(key, [...(groups.get(key) ?? []), task]);
  });
  return [...groups.entries()];
}

export function moduleNameById(modules: WorkModule[], moduleId: string) {
  return modules.find((module) => module.id === moduleId || decodeURIComponent(module.id) === decodeURIComponent(moduleId))?.name ?? moduleId;
}

export function companyById(companies: Company[], companyId: string | null) {
  return companies.find((company) => company.id === companyId) ?? null;
}

// Single source of truth for "is this a measurement/ölçüm document". Both the Documents
// filter and the Ölçüm merkezi must agree, otherwise realistic labels like "Measurement
// photo" show in one screen but not the other. Substring (not exact) match on the combined
// type + fileType + fileName, covering Turkish and English spellings.
export function isMeasurementDocument(document: {
  documentType?: string | null;
  fileType?: string | null;
  fileName?: string | null;
}) {
  const text = `${document.documentType ?? ""} ${document.fileType ?? ""} ${document.fileName ?? ""}`.toLowerCase();
  return (
    text.includes("measurement") ||
    text.includes("ölç") ||
    text.includes("olc") ||
    text.includes("photo") ||
    text.includes("image/")
  );
}

export function tasksForModule(tasks: Task[], moduleId: string) {
  const target = decodeURIComponent(moduleId);
  return tasks.filter((task) => task.moduleIds.some((item) => decodeURIComponent(item) === target));
}

export function statusLabel(status: CompanyStatus | OfferStatus | InvoiceStatus | TaskStatus) {
  switch (status) {
    case "new":
      return "Yeni";
    case "firstContact":
      return "Ilk temas";
    case "interested":
      return "Ilgileniyor";
    case "offerPrepared":
      return "Teklif hazir";
    case "offerSent":
      return "Teklif gonderildi";
    case "followUp":
      return "Takip";
    case "accepted":
      return "Kabul edildi";
    case "invoiceNeeded":
      return "Fatura gerekli";
    case "waitingPayment":
      return "Odeme bekleniyor";
    case "completed":
      return "Tamamlandi";
    case "lost":
      return "Kaybedildi";
    case "draft":
      return "Taslak";
    case "prepared":
      return "Hazir";
    case "sent":
      return "Gonderildi";
    case "followUpNeeded":
      return "Takip gerekli";
    case "rejected":
      return "Reddedildi";
    case "convertedToInvoice":
      return "Faturaya donustu";
    case "unpaid":
      return "Odenmedi";
    case "partiallyPaid":
      return "Kismen odendi";
    case "paid":
      return "Odendi";
    case "overdue":
      return "Gecikti";
    case "open":
      return "Acik";
    case "done":
      return "Tamam";
    case "snoozed":
      return "Ertelendi";
    default:
      return status;
  }
}

export function sortByDateTime<T extends { dueDate?: string | null; dueTime?: string | null }>(items: T[]) {
  // Tarihsiz/saatsiz görevler listenin sonuna düşsün diye boş alanlar en yüksek
  // değere eşlenir (aksi halde boş string en başa sıralanırdı).
  const sortKey = (item: T) => `${item.dueDate ?? "9999-12-31"} ${item.dueTime ?? "99:99"}`;
  return [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

function mapLocale(language: string) {
  switch (language) {
    case "de":
      return "de-DE";
    case "tr":
      return "tr-TR";
    case "ar":
      return "ar";
    case "fr":
      return "fr-FR";
    case "nl":
      return "nl-NL";
    default:
      return "en-US";
  }
}

function normalizeLookup(value: string) {
  return value.trim().toLowerCase();
}

function fallbackByLanguage(language: string, tr: string, en: string, de: string, fr: string, nl: string, ar: string) {
  switch (language) {
    case "tr":
      return tr;
    case "de":
      return de;
    case "fr":
      return fr;
    case "nl":
      return nl;
    case "ar":
      return ar;
    default:
      return en;
  }
}
