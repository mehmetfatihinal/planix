import { useEffect, useState, type PropsWithChildren, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type TextInputProps
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { usePathname, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

// Light, best-effort tactile feedback on primary interactions. No-op where unsupported.
export function tapFeedback() {
  Haptics.selectionAsync().catch(() => undefined);
}

export const colors = {
  appBg: "#0b0c0e",
  appBgAlt: "#101114",
  authBg: "#0b0c0e",
  authPanel: "#15171a",
  authPanelSoft: "#1d2024",
  surface: "#15171a",
  surfaceAlt: "#202327",
  surfaceStrong: "#1a1d21",
  border: "#262a30",
  borderStrong: "#363b43",
  text: "#e8eaed",
  textSoft: "#b8bcc2",
  muted: "#878c93",
  subtle: "#5a6068",
  primary: "#b8344a",
  primaryDark: "#8d2738",
  primarySoft: "rgba(184,52,74,0.12)",
  primaryGlow: "rgba(184,52,74,0.55)",
  shadow: "#000000",
  success: "#3f9b78",
  warning: "#c08b3a",
  danger: "#c54a44",
  inkOnDark: "#e8eaed",
  mutedOnDark: "#b8bcc2",
  lineOnDark: "rgba(255,255,255,0.06)"
};

type ScreenProps = PropsWithChildren<
  ScrollViewProps & {
    tone?: "app" | "auth";
    withTabs?: boolean;
    onRefresh?: () => void;
    refreshing?: boolean;
  }
>;

export function Screen({ children, contentContainerStyle, tone = "app", withTabs = false, onRefresh, refreshing, ...props }: ScreenProps) {
  const appTone = tone === "app";

  return (
    <SafeAreaView
      style={[styles.safeArea, appTone ? styles.safeAreaApp : styles.safeAreaAuth]}
      edges={withTabs ? ["top", "left", "right"] : ["top", "left", "right", "bottom"]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.screen,
          appTone ? styles.screenApp : styles.screenAuth,
          withTabs && styles.screenWithTabs,
          contentContainerStyle
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh
            ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} progressBackgroundColor={colors.surfaceStrong} />
            : undefined
        }
        {...props}
      >
        {children}
      </ScrollView>

      {withTabs ? <BottomNav /> : null}
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  variant = "default",
  index = 0
}: PropsWithChildren<{ style?: object; variant?: "default" | "muted" | "hero" | "dark"; index?: number }>) {
  // Cards lift off the near-black canvas with a real shadow (the hero card gets a crimson-
  // tinted glow — the app's one signature depth cue) and settle in with a short spring on
  // mount. `index` staggers a list of cards; it caps so long lists don't over-delay.
  const shadow = variant === "hero" ? styles.heroShadow : styles.cardShadow;
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18).mass(0.6).delay(Math.min(index, 8) * 45)}
      style={[styles.card, cardVariants[variant], shadow, style]}
    >
      {children}
    </Animated.View>
  );
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionCopy}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  variant = "primary"
}: {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const isInactive = Boolean(loading || disabled);
  return (
    <Pressable
      onPress={onPress ? () => { tapFeedback(); onPress(); } : undefined}
      style={({ pressed }) => [
        styles.button,
        buttonVariants[variant],
        variant === "primary" && !isInactive ? styles.buttonGlow : null,
        pressed && !isInactive ? styles.buttonPressed : null,
        isInactive ? styles.buttonDisabled : null
      ]}
      disabled={isInactive}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" ? colors.text : "#fff"} size="small" />
      ) : (
        <Text style={[styles.buttonText, variant === "secondary" ? styles.buttonTextSecondary : null]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function GhostButton({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress ? () => { tapFeedback(); onPress(); } : undefined} style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}>
      <Text style={styles.ghostButtonText}>{label}</Text>
    </Pressable>
  );
}

export function TextField(props: TextInputProps & { label?: string; right?: ReactNode }) {
  const { label, style, right, ...rest } = props;

  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <View style={styles.inputRow}>
        <TextInput placeholderTextColor={colors.subtle} style={[styles.input, right ? styles.inputWithRight : null, style]} {...rest} />
        {right ? <View style={styles.inputRight}>{right}</View> : null}
      </View>
    </View>
  );
}

export function Chip({ label, tone = "default" }: { label: string; tone?: "default" | "success" | "warning" | "danger" }) {
  return (
    <View style={[styles.chip, chipTones[tone]]}>
      <Text style={[styles.chipText, chipTextTones[tone]]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card variant="muted" style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
    </Card>
  );
}

export function StatTile({ label, value, accent, index = 0 }: { label: string; value: string | number; accent?: string; index?: number }) {
  const valueIsEmpty = value === 0 || value === "0";
  const valueColor = !valueIsEmpty && accent ? accent : colors.text;
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18).mass(0.6).delay(Math.min(index, 6) * 60)}
      style={[styles.statTile, styles.statShadow, !valueIsEmpty && accent ? { borderColor: withAlpha(accent, 0.35) } : null]}
    >
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color: valueColor }]}>{value}</Text>
    </Animated.View>
  );
}

// Overlays an alpha on a hex color for subtle accent borders/tints.
function withAlpha(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return hex;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const current = normalizePath(pathname);
  // Lazy import to avoid React Native barrel cycles
  const { useAuth } = require("@/lib/auth-context") as typeof import("@/lib/auth-context");
  const { user, token } = useAuth();
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

  // Poll the pending-approval count when the user is an admin, so the tab
  // shows a red dot the moment someone submits a completion request.
  useEffect(() => {
    if (!user?.isAdmin || !token) {
      setPendingApprovalCount(0);
      return;
    }
    let cancelled = false;
    const { listPendingApprovals } = require("@/lib/api") as typeof import("@/lib/api");
    const fetchCount = () => {
      listPendingApprovals(token)
        .then((rows: unknown[]) => { if (!cancelled) setPendingApprovalCount(rows.length); })
        .catch(() => undefined);
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [token, user?.isAdmin, pathname]);

  const baseItems = [
    { key: "dashboard", label: "Panel", icon: "home", href: "/(app)" },
    { key: "today", label: "Bugün", icon: "calendar", href: "/(app)/today" },
    { key: "capture", label: "Ses", icon: "mic", href: "/(app)/capture" },
    { key: "tasks", label: "Görevler", icon: "check-square", href: "/(app)/tasks" },
    { key: "settings", label: "Ayarlar", icon: "settings", href: "/(app)/settings" }
  ] as const;
  const items = user?.isAdmin
    ? [
        ...baseItems.slice(0, 4),
        { key: "admin", label: "Yönetici", icon: "shield", href: "/(app)/admin" } as const,
        baseItems[4]
      ]
    : baseItems;

  return (
    <View style={styles.tabBar}>
      {items.map((item) => {
        const active = isTabActive(current, item.key);
        const showDot = item.key === "admin" && pendingApprovalCount > 0;
        return (
          <Pressable key={item.key} onPress={() => router.replace(item.href as never)} style={styles.tabItem}>
            <View style={styles.tabAccent}>
              {active ? <View style={styles.tabAccentBar} /> : null}
            </View>
            <View style={styles.tabIconWrap}>
              <Feather name={item.icon} size={20} color={active ? colors.text : colors.muted} />
              {showDot ? <View style={styles.tabAttentionDot} /> : null}
            </View>
            <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function normalizePath(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace("/(app)", "");
}

function isTabActive(pathname: string, key: string) {
  if (key === "dashboard") return pathname === "/";
  if (key === "today") return pathname.startsWith("/today");
  if (key === "capture") return pathname.startsWith("/capture");
  if (key === "tasks") return pathname.startsWith("/tasks");
  if (key === "admin") return pathname.startsWith("/admin");
  if (key === "settings") return pathname.startsWith("/settings");
  return false;
}

const cardVariants = StyleSheet.create({
  default: {
    backgroundColor: colors.surfaceStrong
  },
  muted: {
    backgroundColor: colors.surfaceAlt
  },
  hero: {
    backgroundColor: "#1e1519",
    borderColor: "rgba(184,52,74,0.32)"
  },
  dark: {
    backgroundColor: colors.authPanel,
    borderColor: colors.border
  }
});

const buttonVariants = StyleSheet.create({
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  secondary: {
    backgroundColor: "transparent",
    borderColor: colors.borderStrong
  },
  danger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger
  }
});

const chipTones = StyleSheet.create({
  default: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border
  },
  success: {
    backgroundColor: "rgba(63,155,120,0.10)",
    borderColor: "rgba(63,155,120,0.28)"
  },
  warning: {
    backgroundColor: "rgba(192,139,58,0.10)",
    borderColor: "rgba(192,139,58,0.28)"
  },
  danger: {
    backgroundColor: "rgba(197,74,68,0.10)",
    borderColor: "rgba(197,74,68,0.28)"
  }
});

const chipTextTones = StyleSheet.create({
  default: {
    color: colors.textSoft
  },
  success: {
    color: colors.success
  },
  warning: {
    color: colors.warning
  },
  danger: {
    color: colors.danger
  }
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1
  },
  safeAreaApp: {
    backgroundColor: colors.appBg
  },
  safeAreaAuth: {
    backgroundColor: colors.authBg
  },
  scroll: {
    flex: 1
  },
  screen: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 18
  },
  screenApp: {
    paddingBottom: 24
  },
  screenAuth: {
    paddingBottom: 24
  },
  screenWithTabs: {
    paddingBottom: 96
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12
  },
  cardShadow: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 14,
    elevation: 6
  },
  heroShadow: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 22,
    elevation: 10
  },
  statShadow: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12
  },
  sectionCopy: {
    flex: 1,
    gap: 3
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.2
  },
  sectionSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  button: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.975 }]
  },
  buttonGlow: {
    shadowColor: colors.primaryGlow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.9,
    shadowRadius: 16,
    elevation: 8
  },
  buttonDisabled: {
    opacity: 0.5
  },
  buttonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.1
  },
  buttonTextSecondary: {
    color: colors.text
  },
  ghostButton: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14
  },
  ghostButtonText: {
    color: colors.textSoft,
    fontSize: 14,
    fontWeight: "500"
  },
  fieldWrap: {
    gap: 6
  },
  inputLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  input: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14
  },
  inputRow: {
    position: "relative",
    justifyContent: "center"
  },
  inputWithRight: {
    paddingRight: 44
  },
  inputRight: {
    position: "absolute",
    right: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  chip: {
    alignSelf: "flex-start",
    minHeight: 24,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  chipText: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.2
  },
  emptyCard: {
    alignItems: "flex-start"
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600"
  },
  emptyDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  statTile: {
    flex: 1,
    minWidth: 140,
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong
  },
  statLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  statValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: -0.4,
    marginTop: 2
  },
  tabBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    backgroundColor: colors.appBgAlt,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 18,
    paddingTop: 6,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 16
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    paddingVertical: 2
  },
  tabAccent: {
    height: 2,
    width: 24,
    marginBottom: 2,
    alignItems: "center",
    justifyContent: "center"
  },
  tabAccentBar: {
    width: 24,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.primary
  },
  tabIconWrap: {
    width: 28,
    height: 24,
    alignItems: "center",
    justifyContent: "center"
  },
  tabAttentionDot: {
    position: "absolute",
    top: -2,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.appBgAlt
  },
  tabText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.2
  },
  tabTextActive: {
    color: colors.text
  }
});
