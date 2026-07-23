import { getLanguageMeta } from "@/lib/i18n";
import type { LanguageCode } from "@/types/business";

export function formatCurrency(value: number, language: LanguageCode, currency = "EUR") {
  return new Intl.NumberFormat(getLanguageMeta(language).locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatNumber(value: number, language: LanguageCode, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(getLanguageMeta(language).locale, options).format(value);
}

export function formatDate(value: string, language: LanguageCode, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(getLanguageMeta(language).locale, {
    dateStyle: "medium",
    ...options
  }).format(new Date(value));
}

export function formatShortDate(value: string | null, language: LanguageCode) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(getLanguageMeta(language).locale, {
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(new Date(value));
}

export function formatPercent(value: number, language: LanguageCode) {
  return new Intl.NumberFormat(getLanguageMeta(language).locale, {
    style: "percent",
    maximumFractionDigits: 0
  }).format(value);
}

export function addDaysIso(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function isoDate(days = 0) {
  return addDaysIso(days).slice(0, 10);
}
