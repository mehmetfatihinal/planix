import ar from "@/locales/ar.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import nl from "@/locales/nl.json";
import tr from "@/locales/tr.json";
import type { LanguageCode } from "@/types/business";

type Dictionary = Record<string, string>;

export const dictionaries: Record<LanguageCode, Dictionary> = {
  en,
  de,
  tr,
  ar,
  fr,
  nl
};

export const languages: Array<{ code: LanguageCode; label: string; locale: string; dir: "ltr" | "rtl" }> = [
  { code: "en", label: "English", locale: "en-GB", dir: "ltr" },
  { code: "de", label: "Deutsch", locale: "de-DE", dir: "ltr" },
  { code: "tr", label: "Türkçe", locale: "tr-TR", dir: "ltr" },
  { code: "ar", label: "العربية", locale: "ar", dir: "rtl" },
  { code: "fr", label: "Français", locale: "fr-FR", dir: "ltr" },
  { code: "nl", label: "Nederlands", locale: "nl-NL", dir: "ltr" }
];

export function getLanguageMeta(language: LanguageCode) {
  return languages.find((item) => item.code === language) ?? languages[1];
}

export function translate(language: LanguageCode, key: string, params?: Record<string, string | number>) {
  const value = dictionaries[language][key] ?? dictionaries.en[key] ?? key;

  if (!params) {
    return value;
  }

  return Object.entries(params).reduce(
    (current, [paramKey, paramValue]) => current.replaceAll(`{${paramKey}}`, String(paramValue)),
    value
  );
}

export function isRtl(language: LanguageCode) {
  return getLanguageMeta(language).dir === "rtl";
}
