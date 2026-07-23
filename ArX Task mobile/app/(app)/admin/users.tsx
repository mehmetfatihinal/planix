import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { AppHeader } from "@/components/app-header";
import { Card, Chip, EmptyState, Screen, colors } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useAppData } from "@/lib/app-data-context";
import { listAdminUsers } from "@/lib/api";
import type { AdminUserSummary } from "@/types/business";

export default function AdminUsersScreen() {
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const { token, user: currentUser, refresh } = useAuth();
  const { promoteUser, demoteUser } = useAppData();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const visibleUsers = useMemo(
    () => (role === "admin" ? users.filter((user) => user.isAdmin) : users),
    [role, users]
  );

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await listAdminUsers(token);
      setUsers(data);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function toggle(user: AdminUserSummary) {
    setError(null);
    setBusyIds((current) => [...current, user.id]);
    try {
      if (user.isAdmin) {
        await demoteUser(user.id);
      } else {
        await promoteUser(user.id);
      }
      if (currentUser?.id === user.id) await refresh();
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Islem basarisiz");
    } finally {
      setBusyIds((current) => current.filter((id) => id !== user.id));
    }
  }

  return (
    <Screen withTabs>
      <AppHeader title="Kullanicilar" subtitle="Yonetim yetkilerini ve gorev dagilimini incele." />
      {error ? <Card><Text style={styles.error}>{error}</Text></Card> : null}
      {loading ? (
        <Card><Text style={styles.muted}>Yukleniyor...</Text></Card>
      ) : visibleUsers.length === 0 ? (
        <EmptyState title="Kullanici yok" description="Henuz kayitli kullanici bulunmuyor." />
      ) : (
        visibleUsers.map((user) => {
          const busy = busyIds.includes(user.id);
          return (
            <Card key={user.id}>
              <View style={styles.headerRow}>
                <View style={styles.copy}>
                  <View style={styles.titleRow}>
                    <Text style={styles.title}>{user.name}</Text>
                    {user.isAdmin ? <Chip label="Yonetici" tone="success" /> : null}
                    {user.isSystemAdmin ? <Chip label="Sistem" tone="warning" /> : null}
                  </View>
                  <Text style={styles.subtitle}>{user.email}</Text>
                  <Text style={styles.meta}>
                    Acik: {user.taskCounts.open} · Bekleyen: {user.taskCounts.pending} · Tamamlanan: {user.taskCounts.done}
                  </Text>
                </View>
                <View style={styles.actionsCol}>
                  <Pressable
                    onPress={() => router.push({ pathname: "/(app)/admin/users/[id]", params: { id: user.id } } as never)}
                    style={[styles.actionButton, styles.detailButton]}
                  >
                    <Feather name="chevron-right" size={16} color={colors.textSoft} />
                    <Text style={[styles.actionText, { color: colors.textSoft }]}>Detaylar</Text>
                  </Pressable>
                  {user.isSystemAdmin ? null : (
                    <Pressable onPress={() => void toggle(user)} style={[styles.actionButton, busy && styles.actionDisabled]} disabled={busy}>
                      <Feather name={user.isAdmin ? "shield-off" : "shield"} size={16} color={user.isAdmin ? colors.danger : colors.primary} />
                      <Text style={[styles.actionText, { color: user.isAdmin ? colors.danger : colors.primary }]}>
                        {user.isAdmin ? "Geri al" : "Yapi yap"}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
  headerRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  copy: { flex: 1, gap: 4 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 13 },
  meta: { color: colors.subtle, fontSize: 12, marginTop: 4 },
  actionsCol: { gap: 6, alignItems: "flex-end" },
  actionButton: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  detailButton: { borderColor: colors.border },
  actionDisabled: { opacity: 0.5 },
  actionText: { fontWeight: "800", fontSize: 13 }
});
