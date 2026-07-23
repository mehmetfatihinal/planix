import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useI18n } from "@/lib/i18n";
import { colors } from "@/components/ui";
import type { LanguageCode } from "@/types/business";

const languageLabels: Record<LanguageCode, string> = {
  en: "English",
  de: "Deutsch",
  tr: "Türkçe",
  ar: "Arabic",
  fr: "Français",
  nl: "Nederlands"
};

export function LanguageSwitcher() {
  const { language, setLanguage } = useI18n();
  const [open, setOpen] = useState(false);
  const items = useMemo(() => Object.keys(languageLabels) as LanguageCode[], []);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable onPress={() => setOpen((current) => !current)} style={[styles.trigger, open ? styles.triggerOpen : null]}>
        <View style={styles.triggerDot} />
        <Text style={styles.triggerText}>{languageLabels[language]}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={14} color="#fff5f3" />
      </Pressable>

      {open ? (
        <View style={styles.menu}>
          {items.map((code) => {
            const active = code === language;

            return (
              <Pressable
                key={code}
                onPress={() => {
                  void setLanguage(code);
                  setOpen(false);
                }}
                style={[styles.menuItem, active ? styles.menuItemActive : null]}
              >
                <Text style={[styles.menuText, active ? styles.menuTextActive : null]}>{languageLabels[code]}</Text>
                {active ? <Feather name="check" size={14} color="#ffd7d8" /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "flex-end"
  },
  trigger: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(25,32,41,0.86)",
    paddingHorizontal: 14
  },
  triggerOpen: {
    borderColor: "rgba(255,179,181,0.45)"
  },
  triggerDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#ffd7d8"
  },
  triggerText: {
    color: "#fff5f3",
    fontSize: 13,
    fontWeight: "700"
  },
  menu: {
    marginTop: 8,
    minWidth: 160,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: colors.authPanel,
    padding: 6,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6
  },
  menuItem: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    paddingHorizontal: 12
  },
  menuItemActive: {
    backgroundColor: "rgba(176,48,64,0.2)"
  },
  menuText: {
    color: colors.mutedOnDark,
    fontSize: 13,
    fontWeight: "700"
  },
  menuTextActive: {
    color: "#fff5f3"
  }
});
