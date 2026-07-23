import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

export function AppHeader({
  title,
  subtitle,
  right,
  showBack
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  // undefined → auto-detect via router.canGoBack(); true/false to force.
  showBack?: boolean;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const initials = (user?.name ?? "AX")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const canGoBack = showBack ?? router.canGoBack();

  return (
    <View style={styles.shell}>
      {canGoBack ? (
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Geri"
        >
          <Feather name="chevron-left" size={22} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ?? (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials || "A"}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 4
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center"
  },
  backButtonPressed: {
    opacity: 0.7
  },
  copy: {
    flex: 1,
    gap: 4
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: -0.4,
    lineHeight: 28
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: {
    color: colors.textSoft,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3
  }
});
