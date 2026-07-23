import { isoDate } from "@/lib/format";
import type {
  AppData,
  CompanyStatus,
  InvoiceStatus,
  ModuleType,
  OfferStatus,
  TaskPriority,
  TaskStatus
} from "@/types/business";

const now = new Date().toISOString();

export const statusPipeline: CompanyStatus[] = [
  "new",
  "firstContact",
  "interested",
  "offerPrepared",
  "offerSent",
  "followUp",
  "accepted",
  "invoiceNeeded",
  "waitingPayment",
  "completed",
  "lost"
];

export const moduleTranslationKey: Record<string, string> = {
  todo: "module.toDo",
  visits: "module.visits",
  calls: "module.calls",
  offers: "module.offers",
  invoices: "module.invoices",
  installation: "module.installation",
  removal: "module.removal",
  repair: "module.repair",
  support: "module.support",
  payments: "module.payments",
  projects: "module.projects",
  delivery: "module.delivery",
  measurements: "module.measurements",
  "led-display": "module.ledDisplay"
};

export const moduleTypeByName: Record<string, ModuleType> = {
  "to do": "todo",
  visits: "visits",
  calls: "calls",
  offers: "offers",
  invoices: "invoices",
  installation: "installation",
  removal: "removal",
  repair: "repair",
  support: "support",
  payments: "payments",
  projects: "projects",
  delivery: "delivery",
  measurements: "measurements",
  "led display": "custom"
};

function taskCount(moduleId: string, tasks: AppData["tasks"]) {
  return tasks.filter((task) => task.moduleIds.includes(moduleId) && task.status !== "done").length;
}

const companies: AppData["companies"] = [
  {
    id: "company-mara",
    name: "Mara Market",
    address: "Kaiserstr. 21, 60311 Frankfurt am Main",
    phone: "+49 69 442210",
    email: "info@mara-market.de",
    contactPerson: "Murat Aydin",
    latitude: 50.112,
    longitude: 8.681,
    status: "followUp",
    tags: ["LED", "Retail", "Hot lead"],
    createdAt: now,
    updatedAt: now
  },
  {
    id: "company-hira",
    name: "Hira Market",
    address: "Hanauer Landstr. 74, 60314 Frankfurt am Main",
    phone: "+49 69 778899",
    email: "kontakt@hira-market.de",
    contactPerson: "Elif Kaya",
    latitude: 50.116,
    longitude: 8.711,
    status: "waitingPayment",
    tags: ["Displays", "Invoice"],
    createdAt: now,
    updatedAt: now
  },
  {
    id: "company-bonita",
    name: "Bonita Cafe",
    address: "Berliner Str. 12, 63065 Offenbach",
    phone: "+49 69 330012",
    email: "hello@bonitacafe.de",
    contactPerson: "Sofia Martins",
    latitude: 50.105,
    longitude: 8.765,
    status: "offerPrepared",
    tags: ["Cafe", "Menu"],
    createdAt: now,
    updatedAt: now
  },
  {
    id: "company-bross",
    name: "Bross Döner",
    address: "Mainzer Landstr. 188, 60327 Frankfurt am Main",
    phone: "+49 69 990011",
    email: "office@bross-doener.de",
    contactPerson: "Kemal Bross",
    latitude: 50.102,
    longitude: 8.647,
    status: "interested",
    tags: ["Digital menu", "Installation"],
    createdAt: now,
    updatedAt: now
  }
];

const tasks: AppData["tasks"] = [
  {
    id: "task-mara-followup",
    companyId: "company-mara",
    title: "Call Mara Market about LED screen offer",
    description: "Follow up on the 65 inch display and installation package.",
    type: "calls",
    moduleIds: ["module-calls", "module-offers"],
    dueDate: isoDate(0),
    dueTime: "10:30",
    timeWindow: null,
    reminderInterval: "Every 2 hours until done",
    repeatUntilDone: true,
    status: "open",
    priority: "high",
    createdAt: now,
    completedAt: null
  },
  {
    id: "task-hira-payment",
    companyId: "company-hira",
    title: "Send payment reminder for invoice RE-2026-018",
    description: "Payment is 5 days overdue. Send German reminder and schedule call.",
    type: "payments",
    moduleIds: ["module-payments", "module-invoices"],
    dueDate: isoDate(0),
    dueTime: "14:00",
    timeWindow: null,
    reminderInterval: "Daily",
    repeatUntilDone: true,
    status: "overdue",
    priority: "high",
    createdAt: now,
    completedAt: null
  },
  {
    id: "task-bonita-offer",
    companyId: "company-bonita",
    title: "Prepare 3-package offer for digital menu",
    description: "Economy QR menu, standard display menu, premium display plus design package.",
    type: "offers",
    moduleIds: ["module-offers", "module-projects"],
    dueDate: isoDate(0),
    dueTime: "16:00",
    timeWindow: null,
    reminderInterval: null,
    repeatUntilDone: false,
    status: "open",
    priority: "medium",
    createdAt: now,
    completedAt: null
  },
  {
    id: "task-bross-visit",
    companyId: "company-bross",
    title: "Visit and inspect digital menu screen position",
    description: "Measure counter wall and confirm cable route.",
    type: "visits",
    moduleIds: ["module-visits", "module-installation", "module-measurements"],
    dueDate: isoDate(0),
    dueTime: null,
    timeWindow: "15:00 - 17:00",
    reminderInterval: "Every 1 hour until done",
    repeatUntilDone: true,
    status: "open",
    priority: "medium",
    createdAt: now,
    completedAt: null
  },
  {
    id: "task-old-removal",
    companyId: "company-mara",
    title: "Remove old poster frame before installation",
    description: "Bring drill, ladder, and replacement screws.",
    type: "removal",
    moduleIds: ["module-removal", "module-installation"],
    dueDate: isoDate(-1),
    dueTime: "11:00",
    timeWindow: null,
    reminderInterval: null,
    repeatUntilDone: false,
    status: "overdue",
    priority: "medium",
    createdAt: now,
    completedAt: null
  }
];

const modulesBase: AppData["modules"] = [
  { id: "module-todo", name: "To Do", type: "todo", createdByAI: false, isPinnedToSidebar: true, taskCount: 0, createdAt: now },
  { id: "module-visits", name: "Visits", type: "visits", createdByAI: false, isPinnedToSidebar: true, taskCount: 0, createdAt: now },
  { id: "module-calls", name: "Calls", type: "calls", createdByAI: false, isPinnedToSidebar: true, taskCount: 0, createdAt: now },
  { id: "module-offers", name: "Offers", type: "offers", createdByAI: false, isPinnedToSidebar: true, taskCount: 0, createdAt: now },
  { id: "module-invoices", name: "Invoices", type: "invoices", createdByAI: false, isPinnedToSidebar: true, taskCount: 0, createdAt: now },
  { id: "module-installation", name: "Installation", type: "installation", createdByAI: false, isPinnedToSidebar: true, taskCount: 0, createdAt: now },
  { id: "module-removal", name: "Removal", type: "removal", createdByAI: false, isPinnedToSidebar: false, taskCount: 0, createdAt: now },
  { id: "module-repair", name: "Repair", type: "repair", createdByAI: false, isPinnedToSidebar: false, taskCount: 0, createdAt: now },
  { id: "module-support", name: "Support", type: "support", createdByAI: false, isPinnedToSidebar: true, taskCount: 0, createdAt: now },
  { id: "module-payments", name: "Payments", type: "payments", createdByAI: false, isPinnedToSidebar: true, taskCount: 0, createdAt: now },
  { id: "module-projects", name: "Projects", type: "projects", createdByAI: false, isPinnedToSidebar: false, taskCount: 0, createdAt: now },
  { id: "module-delivery", name: "Delivery", type: "delivery", createdByAI: false, isPinnedToSidebar: false, taskCount: 0, createdAt: now },
  { id: "module-measurements", name: "Measurements", type: "measurements", createdByAI: true, isPinnedToSidebar: true, taskCount: 0, createdAt: now },
  { id: "module-led-display", name: "LED Display", type: "custom", createdByAI: true, isPinnedToSidebar: true, taskCount: 0, createdAt: now }
];

export const mockData: AppData = {
  companies,
  modules: modulesBase.map((module) => ({ ...module, taskCount: taskCount(module.id, tasks) })),
  tasks,
  notes: [
    {
      id: "note-mara-1",
      companyId: "company-mara",
      taskId: "task-mara-followup",
      content: "Customer asked for a clean premium offer with installation and a cheaper alternative.",
      sourceType: "voice",
      sourceTranscript: "Mara wants LED display offer with installation.",
      createdAt: now
    },
    {
      id: "note-bonita-1",
      companyId: "company-bonita",
      taskId: null,
      content: "Bonita Cafe prefers a 3-package offer and German-friendly wording.",
      sourceType: "manual",
      sourceTranscript: null,
      createdAt: now
    }
  ],
  documents: [
    {
      id: "doc-mara-measurement",
      companyId: "company-mara",
      fileName: "mara-led-measurement-photo.jpg",
      fileType: "image/jpeg",
      documentType: "Measurement photo",
      extractedText: "Wall width 420 cm, height 80 cm. Power socket on right side.",
      summary: "Measurement image for Mara Market LED wall.",
      uploadedAt: now
    },
    {
      id: "doc-hira-invoice",
      companyId: "company-hira",
      fileName: "RE-2026-018.pdf",
      fileType: "application/pdf",
      documentType: "Invoice PDF",
      extractedText: "Invoice RE-2026-018 due 2026-04-20 total 1,190.00 EUR.",
      summary: "Overdue invoice for Hira Market.",
      uploadedAt: now
    },
    {
      id: "doc-price-list",
      companyId: null,
      fileName: "display-price-list-2026.pdf",
      fileType: "application/pdf",
      documentType: "Price list",
      extractedText: "50 inch Display 580 EUR, 65 inch Display 1000 EUR, Indoor LED P2.5 m2 price.",
      summary: "Current display and LED price list.",
      uploadedAt: now
    }
  ],
  offers: [
    {
      id: "offer-mara-65",
      companyId: "company-mara",
      offerNumber: "AN-2026-014",
      offerDate: isoDate(-3),
      title: "65 inch display with installation",
      status: "sent",
      items: [
        {
          id: "item-display-65",
          productName: "65 inch Display",
          description: "Commercial display for market entrance",
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000
        },
        {
          id: "item-installation",
          productName: "Installation Service",
          description: "Mounting, cable route, setup",
          quantity: 1,
          unitPrice: 350,
          totalPrice: 350
        }
      ],
      subtotal: 1350,
      vatRate: 0.19,
      vatAmount: 256.5,
      total: 1606.5,
      currency: "EUR",
      validityDays: 14,
      notes: "Offer valid for 14 days. Delivery after acceptance.",
      pdfUrl: null
    },
    {
      id: "offer-bonita-menu",
      companyId: "company-bonita",
      offerNumber: "AN-2026-017",
      offerDate: isoDate(0),
      title: "Digital menu system packages",
      status: "prepared",
      items: [
        {
          id: "item-menu-system",
          productName: "Digital TV Menu System",
          description: "Menu layout, screen setup, content handover",
          quantity: 1,
          unitPrice: 890,
          totalPrice: 890
        }
      ],
      subtotal: 890,
      vatRate: 0.19,
      vatAmount: 169.1,
      total: 1059.1,
      currency: "EUR",
      validityDays: 10,
      notes: "Package options can be adjusted after first feedback.",
      pdfUrl: null
    }
  ],
  invoices: [
    {
      id: "invoice-hira-018",
      companyId: "company-hira",
      invoiceNumber: "RE-2026-018",
      invoiceDate: isoDate(-15),
      dueDate: isoDate(-5),
      status: "overdue",
      items: [
        {
          id: "invoice-item-display",
          productName: "50 inch Display",
          description: "Display and setup",
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000
        }
      ],
      subtotal: 1000,
      vatRate: 0.19,
      total: 1190,
      paidAt: null
    },
    {
      id: "invoice-bross-011",
      companyId: "company-bross",
      invoiceNumber: "RE-2026-011",
      invoiceDate: isoDate(-24),
      dueDate: isoDate(-10),
      status: "paid",
      items: [
        {
          id: "invoice-item-design",
          productName: "Menu Design",
          description: "Digital menu design refresh",
          quantity: 1,
          unitPrice: 420,
          totalPrice: 420
        }
      ],
      subtotal: 420,
      vatRate: 0.19,
      total: 499.8,
      paidAt: isoDate(-8)
    }
  ],
  products: [
    {
      id: "product-display-50",
      name: "50 inch Display",
      category: "Displays",
      description: "Commercial display for menus and promotions",
      costPrice: 410,
      sellingPrice: 580,
      minimumPrice: 520,
      currency: "EUR",
      margin: 0.29,
      updatedAt: isoDate(-2)
    },
    {
      id: "product-display-65",
      name: "65 inch Display",
      category: "Displays",
      description: "Large commercial display for retail areas",
      costPrice: 730,
      sellingPrice: 1000,
      minimumPrice: 920,
      currency: "EUR",
      margin: 0.27,
      updatedAt: isoDate(-4)
    },
    {
      id: "product-led-indoor",
      name: "Indoor LED P2.5",
      category: "LED Screens",
      description: "Indoor LED wall by square meter",
      costPrice: 980,
      sellingPrice: 1638,
      minimumPrice: 1450,
      currency: "EUR",
      margin: 0.4,
      updatedAt: isoDate(-1)
    },
    {
      id: "product-led-outdoor",
      name: "Outdoor LED P2.5",
      category: "LED Screens",
      description: "Outdoor LED wall by square meter",
      costPrice: 1180,
      sellingPrice: 1890,
      minimumPrice: 1680,
      currency: "EUR",
      margin: 0.38,
      updatedAt: isoDate(-1)
    },
    {
      id: "product-menu-system",
      name: "Digital TV Menu System",
      category: "Digital Menu Systems",
      description: "Screen menu setup, layout, and update handover",
      costPrice: 390,
      sellingPrice: 890,
      minimumPrice: 690,
      currency: "EUR",
      margin: 0.56,
      updatedAt: isoDate(-6)
    },
    {
      id: "product-qr-menu",
      name: "QR Menu System",
      category: "QR Menu",
      description: "QR menu website and printable code cards",
      costPrice: 140,
      sellingPrice: 390,
      minimumPrice: 290,
      currency: "EUR",
      margin: 0.64,
      updatedAt: isoDate(-9)
    },
    {
      id: "product-menu-design",
      name: "Menu Design",
      category: "Design Services",
      description: "Menu layout and product photo cleanup",
      costPrice: 120,
      sellingPrice: 420,
      minimumPrice: 320,
      currency: "EUR",
      margin: 0.71,
      updatedAt: isoDate(-10)
    },
    {
      id: "product-installation",
      name: "Installation Service",
      category: "Installation",
      description: "Mounting, setup, and customer handover",
      costPrice: 120,
      sellingPrice: 350,
      minimumPrice: 280,
      currency: "EUR",
      margin: 0.66,
      updatedAt: isoDate(-3)
    }
  ],
  reminders: [
    {
      id: "reminder-mara-followup",
      taskId: "task-mara-followup",
      startTime: isoDate(0),
      repeatInterval: "Every 2 hours",
      activeUntilDone: true,
      status: "active"
    },
    {
      id: "reminder-hira-payment",
      taskId: "task-hira-payment",
      startTime: isoDate(0),
      repeatInterval: "Daily",
      activeUntilDone: true,
      status: "active"
    }
  ],
  timeline: [
    {
      id: "timeline-mara-offer",
      companyId: "company-mara",
      type: "offer",
      title: "Offer AN-2026-014 sent",
      description: "65 inch display with installation. Follow-up needed.",
      date: isoDate(-3),
      relatedId: "offer-mara-65"
    },
    {
      id: "timeline-hira-invoice",
      companyId: "company-hira",
      type: "invoice",
      title: "Invoice RE-2026-018 overdue",
      description: "Payment reminder should be sent in German.",
      date: isoDate(-5),
      relatedId: "invoice-hira-018"
    },
    {
      id: "timeline-bonita-note",
      companyId: "company-bonita",
      type: "note",
      title: "Customer asked for package comparison",
      description: "Prepare economy, standard, and premium options.",
      date: isoDate(0),
      relatedId: "note-bonita-1"
    }
  ],
  routes: [
    {
      id: "route-today",
      date: isoDate(0),
      totalDistance: "24.8 km",
      totalDuration: "1h 18m",
      stops: [
        { id: "stop-mara", companyId: "company-mara", order: 1, distanceFromPrevious: "4.2 km", durationFromPrevious: "12m" },
        { id: "stop-bross", companyId: "company-bross", order: 2, distanceFromPrevious: "8.5 km", durationFromPrevious: "22m" },
        { id: "stop-bonita", companyId: "company-bonita", order: 3, distanceFromPrevious: "12.1 km", durationFromPrevious: "44m" }
      ]
    }
  ]
};

export function getStatusKey(status: CompanyStatus | OfferStatus | InvoiceStatus | TaskStatus) {
  return `status.${status}`;
}

export function getPriorityKey(priority: TaskPriority) {
  return `priority.${priority}`;
}
