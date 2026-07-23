import { isoDate } from "@/lib/format";
import type { LanguageCode, ParsedBusinessInput } from "@/types/business";

const languageHints: Array<{ language: LanguageCode; words: string[] }> = [
  { language: "de", words: ["morgen", "uhr", "gehen", "angebot", "rechnung", "bildschirm", "ausmessen"] },
  { language: "tr", words: ["yarın", "sonra", "git", "teklif", "fatura", "ölç", "hatırlat"] },
  { language: "ar", words: ["غداً", "بعد", "اذهب", "عرض", "فاتورة", "قس", "ذكرني"] },
  { language: "fr", words: ["demain", "après", "aller", "offre", "facture", "mesurer", "rappeler"] },
  { language: "nl", words: ["morgen", "naar", "offerte", "factuur", "meten", "herinner"] }
];

export function detectInputLanguage(inputText: string): LanguageCode {
  const lower = inputText.toLowerCase();
  const match = languageHints
    .map((hint) => ({
      language: hint.language,
      score: hint.words.filter((word) => lower.includes(word.toLowerCase())).length
    }))
    .sort((a, b) => b.score - a.score)[0];

  return match && match.score > 0 ? match.language : "en";
}

export function parseBusinessInput(inputText: string): ParsedBusinessInput {
  const text = inputText.trim();
  const lower = text.toLowerCase();
  const detectedLanguage = detectInputLanguage(text);
  const companyMatch =
    text.match(/mara market/i)?.[0] ??
    text.match(/hira market/i)?.[0] ??
    text.match(/bonita cafe/i)?.[0] ??
    text.match(/bross döner/i)?.[0] ??
    null;
  const hasLed = lower.includes("led") || lower.includes("bildschirm") || lower.includes("ekran");
  const hasOffer = lower.includes("offer") || lower.includes("angebot") || lower.includes("teklif") || lower.includes("offerte");
  const hasVisit =
    lower.includes("go") ||
    lower.includes("visit") ||
    lower.includes("gehen") ||
    lower.includes("git") ||
    lower.includes("aller") ||
    lower.includes("naar");
  const tomorrow =
    lower.includes("tomorrow") ||
    lower.includes("morgen") ||
    lower.includes("yarın") ||
    lower.includes("demain") ||
    lower.includes("غداً");
  const afterTwelve =
    lower.includes("after 12") ||
    lower.includes("nach 12") ||
    lower.includes("12'den sonra") ||
    lower.includes("après 12") ||
    lower.includes("بعد 12");
  const reminder =
    lower.includes("every hour") ||
    lower.includes("jede stunde") ||
    lower.includes("her saat") ||
    lower.includes("chaque heure") ||
    lower.includes("elk uur");

  return {
    detectedLanguage,
    company: {
      name: companyMatch ? normalizeCompanyName(companyMatch) : null,
      confidence: companyMatch ? 0.94 : 0.22,
      shouldCreateIfMissing: Boolean(companyMatch)
    },
    modules: [
      { name: "Visits", confidence: hasVisit ? 0.91 : 0.62, shouldCreateIfMissing: hasVisit },
      { name: "Offers", confidence: hasOffer ? 0.92 : 0.68, shouldCreateIfMissing: hasOffer },
      { name: hasLed ? "Measurements" : "To Do", confidence: hasLed ? 0.86 : 0.62, shouldCreateIfMissing: hasLed },
      { name: "LED Display", confidence: hasLed ? 0.81 : 0.4, shouldCreateIfMissing: hasLed }
    ].filter((module) => module.confidence >= 0.6),
    tasks: [
      {
        title:
          hasLed && hasOffer
            ? "Visit after 12, measure LED display, and prepare offer"
            : hasLed
              ? "Visit after 12 and measure LED display"
              : "Create business follow-up task",
        type: hasVisit ? "visits" : "todo",
        dueDate: tomorrow ? isoDate(1) : isoDate(0),
        dueTime: null,
        timeWindow: afterTwelve ? "after 12:00" : null,
        priority: hasOffer ? "high" : "medium",
        reminderRule: reminder ? "Every 1 hour until done" : null
      }
    ],
    notes: [text],
    offerData: {
      detected: hasOffer,
      products: hasLed ? ["LED Display", "Installation Service"] : [],
      prices: [],
      currency: "EUR"
    },
    documentData: {
      detected: lower.includes("pdf") || lower.includes("image") || lower.includes("foto"),
      type: lower.includes("pdf") ? "PDF" : lower.includes("image") || lower.includes("foto") ? "Photo" : null
    }
  };
}

function normalizeCompanyName(name: string) {
  return name
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
