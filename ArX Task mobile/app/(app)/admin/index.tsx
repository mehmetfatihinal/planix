import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AppHeader } from "@/components/app-header";
import { Card, EmptyState, Screen, StatTile, colors } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { listAdminUsers } from "@/lib/api";
import type { AdminUserSummary } from "@/types/business";

export default function AdminHomeScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);

  useEffect(() => {
    if (!token) return;
    listAdminUsers(token)
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [token]);

  const totals = (users ?? []).reduce(
    (acc, user) => {
      acc.users += 1;
      acc.admins += user.isAdmin ? 1 : 0;
      acc.pending += user.taskCounts.pending;
      acc.open += user.taskCounts.open;
      return acc;
    },
    { users: 0, admins: 0, pending: 0, open: 0 }
  );

  return (
    <Screen withTabs>
      <AppHeader
        title="Yonetici paneli"
        subtitle="Onay bekleyen gorevleri yonet, kullanicilari ve sistem kullanimini izle."
      />

      <View style={styles.statsGrid}>
        <Pressable onPress={() => router.push("/(app)/admin/users" as never)} style={styles.statWrap}>
          <StatTile label="Kullanici" value={totals.users} accent={colors.text} />
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: "/(app)/admin/users", params: { role: "admin" } } as never)} style={styles.statWrap}>
          <StatTile label="Yonetici" value={totals.admins} accent={colors.success} />
        </Pressable>
        <Pressable onPress={() => router.push("/(app)/admin/approvals" as never)} style={styles.statWrap}>
          <StatTile label="Onay bekleyen" value={totals.pending} accent={totals.pending ? colors.warning : colors.success} />
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: "/(app)/admin/tasks", params: { status: "open" } } as never)} style={styles.statWrap}>
          <StatTile label="Acik gorev" value={totals.open} accent={colors.primary} />
        </Pressable>
      </View>

      <Pressable onPress={() => router.push("/(app)/admin/approvals" as never)}>
        <Card>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <Feather name="shield" size={20} color={colors.primary} />
            </View>
            <View style={styles.copy}>
              <Text style={styles.tileTitle}>Onay Bekleyenler</Text>
              <Text style={styles.tileText}>{totals.pending} adet gorev onayini bekliyor.</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.subtle} />
          </View>
        </Card>
      </Pressable>

      <Pressable onPress={() => router.push("/(app)/admin/users" as never)}>
        <Card>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <Feather name="users" size={20} color={colors.primary} />
            </View>
            <View style={styles.copy}>
              <Text style={styles.tileTitle}>Kullanicilar</Text>
              <Text style={styles.tileText}>{totals.users} kullanici. Yetki yonetimi ve gorev dagilimi.</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.subtle} />
          </View>
        </Card>
      </Pressable>

      {users && users.length === 0 ? (
        <EmptyState title="Henuz veri yok" description="Kullanicilar ve gorevler eklendikce burada gozukur." />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12
  },
  statWrap: {
    flexGrow: 1,
    flexBasis: "47%"
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center"
  },
  copy: { flex: 1, gap: 2 },
  tileTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  tileText: { color: colors.muted, fontSize: 13 }
});
