import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { AppHeader } from "@/components/app-header";
import { Card, Chip, EmptyState, Screen, colors } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { listAdminCompanies, listAdminTasks, listAdminUsers } from "@/lib/api";
import type { AdminCompanySummary, AdminTaskRow, AdminUserSummary } from "@/types/business";

const STATUSES = [
  { value: "", label: "Tümü" },
  { value: "open", label: "Açık" },
  { value: "pending_approval", label: "Onay bekliyor" },
  { value: "done", label: "Tamamlanan" },
  { value: "snoozed", label: "Ertelenen" }
];

export default function AdminTasksScreen() {
  const { token } = useAuth();
  const params = useLocalSearchParams<{ status?: string; userId?: string; companyId?: string }>();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [companies, setCompanies] = useState<AdminCompanySummary[]>([]);
  const [userId, setUserId] = useState<string>(params.userId ?? "");
  const [companyId, setCompanyId] = useState<string>(params.companyId ?? "");
  const [status, setStatus] = useState<string>(params.status ?? "");
  const [rows, setRows] = useState<AdminTaskRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Reference lookups once
  useEffect(() => {
    if (!token) return;
    listAdminUsers(token).then(setUsers).catch(() => undefined);
    listAdminCompanies(token).then(setCompanies).catch(() => undefined);
  }, [token]);

  const filteredCompanies = useMemo(
    () => (userId ? companies.filter((c) => c.userId === userId) : companies),
    [companies, userId]
  );

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await listAdminTasks(token, {
        userId: userId || undefined,
        companyId: companyId || undefined,
        status: status || undefined
      });
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [companyId, status, token, userId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Screen withTabs>
      <AppHeader title="Tüm Görevler" subtitle="Kullanıcı, firma ve duruma göre filtrele." />

      <Card>
        <Text style={styles.label}>Kullanıcı</Text>
        <View style={styles.row}>
          <SelectablePill label="Tümü" active={!userId} onPress={() => { setUserId(""); setCompanyId(""); }} />
          {users.slice(0, 8).map((user) => (
            <SelectablePill
              key={user.id}
              label={user.name}
              active={userId === user.id}
              onPress={() => { setUserId(user.id); setCompanyId(""); }}
            />
          ))}
        </View>

        <Text style={[styles.label, styles.labelSpacing]}>Durum</Text>
        <View style={styles.row}>
          {STATUSES.map((item) => (
            <SelectablePill
              key={item.value || "all"}
              label={item.label}
              active={status === item.value}
              onPress={() => setStatus(item.value)}
            />
          ))}
        </View>

        {filteredCompanies.length > 0 ? (
          <>
            <Text style={[styles.label, styles.labelSpacing]}>Firma</Text>
            <View style={styles.row}>
              <SelectablePill label="Tümü" active={!companyId} onPress={() => setCompanyId("")} />
              {filteredCompanies.slice(0, 12).map((company) => (
                <SelectablePill
                  key={company.id}
                  label={company.name}
                  active={companyId === company.id}
                  onPress={() => setCompanyId(company.id)}
                />
              ))}
            </View>
          </>
        ) : null}
      </Card>

      {loading ? (
        <Card><Text style={styles.muted}>Yükleniyor...</Text></Card>
      ) : rows.length === 0 ? (
        <EmptyState title="Görev bulunamadı" description="Seçili filtreyle eşleşen görev yok." />
      ) : (
        rows.map((row) => (
          <Card key={row.task.id}>
            <View style={styles.titleRow}>
              <Text style={styles.taskTitle}>{row.task.title}</Text>
              <Chip
                label={row.task.status}
                tone={
                  row.task.status === "done" ? "success"
                  : row.task.status === "pending_approval" ? "warning"
                  : row.task.status === "overdue" ? "danger"
                  : "default"
                }
              />
            </View>
            <Text style={styles.subtitle}>
              {row.user?.name ?? row.task.userId} · {row.company?.name ?? "Kişisel"}
            </Text>
            <Text style={styles.meta}>{row.task.dueDate ?? "-"} {row.task.dueTime ?? ""}</Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

function SelectablePill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.subtle, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  labelSpacing: { marginTop: 14 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  pillTextActive: { color: "#fff5f3" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  taskTitle: { color: colors.text, fontSize: 16, fontWeight: "800", flexShrink: 1 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 4 },
  meta: { color: colors.subtle, fontSize: 12, marginTop: 4 },
  muted: { color: colors.muted, fontSize: 14 }
});
