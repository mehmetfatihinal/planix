import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppHeader } from "@/components/app-header";
import { Card, Chip, EmptyState, PrimaryButton, Screen, StatTile, colors } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useAppData } from "@/lib/app-data-context";
import { apiRequest, listAdminCompanies, listAdminUsers } from "@/lib/api";
import type { AdminCompanySummary, AdminUserSummary, Task } from "@/types/business";

function groupTasks(tasks: Task[]) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const groups = { open: [] as Task[], pending: [] as Task[], done: [] as Task[], snoozed: [] as Task[], overdue: [] as Task[] };
  tasks.forEach((task) => {
    if (task.status === "done") groups.done.push(task);
    else if (task.status === "pending_approval") groups.pending.push(task);
    else if (task.status === "snoozed") groups.snoozed.push(task);
    else if (task.status === "open") {
      const overdue = Boolean(task.dueDate && task.dueDate < todayIso);
      (overdue ? groups.overdue : groups.open).push(task);
    }
  });
  return groups;
}

export default function AdminUserDetailScreen() {
  const router = useRouter();
  const { id: userId } = useLocalSearchParams<{ id: string }>();
  const { token, user: currentUser, refresh } = useAuth();
  const { promoteUser, demoteUser, approveTask, rejectTask } = useAppData();

  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [companies, setCompanies] = useState<AdminCompanySummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Task | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [section, setSection] = useState<"open" | "overdue" | "pending" | "done" | "companies">("open");

  const load = useCallback(async () => {
    if (!token || !userId) return;
    setLoading(true);
    try {
      const [userList, companyList, taskList] = await Promise.all([
        listAdminUsers(token),
        listAdminCompanies(token),
        apiRequest<Task[]>(`/admin/users/${userId}/tasks`, {}, token)
      ]);
      setUsers(userList);
      setCompanies(companyList);
      setTasks(taskList);
    } finally {
      setLoading(false);
    }
  }, [token, userId]);

  useEffect(() => { void load(); }, [load]);

  const user = useMemo(() => users.find((item) => item.id === userId) ?? null, [users, userId]);
  const userCompanies = useMemo(() => companies.filter((c) => c.userId === userId), [companies, userId]);
  const groups = useMemo(() => groupTasks(tasks), [tasks]);
  const companyMap = useMemo(() => {
    const map = new Map<string, AdminCompanySummary>();
    userCompanies.forEach((c) => map.set(c.id, c));
    return map;
  }, [userCompanies]);

  async function toggleAdmin() {
    if (!user || user.isSystemAdmin) return;
    setError(null);
    setBusy(true);
    try {
      if (user.isAdmin) await demoteUser(user.id);
      else await promoteUser(user.id);
      if (currentUser?.id === user.id) await refresh();
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Islem basarisiz");
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove(task: Task) {
    setBusy(true);
    try {
      await approveTask(userId as string, task.id);
      await load();
    } finally { setBusy(false); }
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    const task = rejectTarget;
    setBusy(true);
    try {
      await rejectTask(userId as string, task.id, rejectReason);
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } finally { setBusy(false); }
  }

  if (loading) {
    return (
      <Screen withTabs>
        <BackLink onPress={() => router.back()} />
        <Card><Text style={styles.muted}>Yukleniyor...</Text></Card>
      </Screen>
    );
  }

  if (!user) {
    return (
      <Screen withTabs>
        <BackLink onPress={() => router.back()} />
        <EmptyState title="Kullanici bulunamadi" description="Bu ID'ye karsi gelen kullanici yok." />
      </Screen>
    );
  }

  const sectionTasks = section === "open" ? groups.open
    : section === "overdue" ? groups.overdue
    : section === "pending" ? groups.pending
    : section === "done" ? groups.done.slice(0, 30)
    : [];

  return (
    <Screen withTabs>
      <BackLink onPress={() => router.back()} />

      <AppHeader
        title={user.name}
        subtitle={user.email}
      />
      <View style={styles.badgeRow}>
        {user.isAdmin ? <Chip label="Yonetici" tone="success" /> : null}
        {user.isSystemAdmin ? <Chip label="Sistem" tone="warning" /> : null}
        {!user.isSystemAdmin ? (
          <Pressable onPress={() => void toggleAdmin()} style={[styles.actionButton, busy && styles.actionDisabled]} disabled={busy}>
            <Feather name={user.isAdmin ? "shield-off" : "shield"} size={15} color={user.isAdmin ? colors.danger : colors.primary} />
            <Text style={[styles.actionText, { color: user.isAdmin ? colors.danger : colors.primary }]}>
              {user.isAdmin ? "Yetkiyi al" : "Yonetici yap"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Card><Text style={styles.error}>{error}</Text></Card> : null}

      <View style={styles.statsGrid}>
        <Pressable onPress={() => setSection("open")} style={styles.statWrap}>
          <StatTile label="Acik" value={groups.open.length} accent={section === "open" ? colors.primary : colors.text} />
        </Pressable>
        <Pressable onPress={() => setSection("overdue")} style={styles.statWrap}>
          <StatTile label="Geciken" value={groups.overdue.length} accent={section === "overdue" ? colors.danger : groups.overdue.length ? colors.danger : colors.subtle} />
        </Pressable>
        <Pressable onPress={() => setSection("pending")} style={styles.statWrap}>
          <StatTile label="Onay bekleyen" value={groups.pending.length} accent={section === "pending" ? colors.warning : groups.pending.length ? colors.warning : colors.subtle} />
        </Pressable>
        <Pressable onPress={() => setSection("done")} style={styles.statWrap}>
          <StatTile label="Tamamlanan" value={groups.done.length} accent={section === "done" ? colors.success : colors.subtle} />
        </Pressable>
        <Pressable onPress={() => setSection("companies")} style={styles.statWrap}>
          <StatTile label="Firma" value={userCompanies.length} accent={section === "companies" ? colors.primary : colors.text} />
        </Pressable>
      </View>

      {section === "companies" ? (
        <Card>
          <Text style={styles.sectionTitle}>Firmalari</Text>
          {userCompanies.length === 0 ? (
            <Text style={styles.muted}>Henuz firma eklenmedi.</Text>
          ) : (
            userCompanies.map((company) => {
              const count = tasks.filter((task) => task.companyId === company.id).length;
              return (
                <Pressable
                  key={company.id}
                  onPress={() => router.push({ pathname: "/(app)/companies/[id]", params: { id: company.id } } as never)}
                  style={styles.companyRow}
                >
                  <View style={styles.companyCopy}>
                    <Text style={styles.companyName}>{company.name}</Text>
                    <Text style={styles.companyMeta}>{company.address || "—"}</Text>
                  </View>
                  <Chip label={`${count} gorev`} />
                </Pressable>
              );
            })
          )}
        </Card>
      ) : (
        <Card>
          <Text style={styles.sectionTitle}>
            {section === "open" ? "Acik gorevler"
            : section === "overdue" ? "Geciken gorevler"
            : section === "pending" ? "Onay bekleyen gorevler"
            : "Son tamamlananlar"}
          </Text>
          {sectionTasks.length === 0 ? (
            <Text style={styles.muted}>Bu kategoride gorev yok.</Text>
          ) : (
            sectionTasks.map((task) => {
              const company = task.companyId ? companyMap.get(task.companyId) : null;
              return (
                <View key={task.id} style={styles.taskRow}>
                  <View style={styles.taskCopy}>
                    <Text style={styles.taskTitle}>{task.title}</Text>
                    <Text style={styles.taskMeta}>
                      {company?.name ?? "Kisisel"} · {task.dueDate ?? "-"} {task.dueTime ?? ""}
                    </Text>
                    {section === "pending" && task.completionRequestedNote ? (
                      <Text style={styles.taskNote}>Not: {task.completionRequestedNote}</Text>
                    ) : null}
                  </View>
                  {section === "pending" ? (
                    <View style={styles.pendingActions}>
                      <Pressable onPress={() => void handleApprove(task)} style={[styles.smallButton, styles.approveButton]} disabled={busy}>
                        <Feather name="check" size={13} color="#fff5f3" />
                        <Text style={styles.smallButtonTextLight}>Onayla</Text>
                      </Pressable>
                      <Pressable onPress={() => { setRejectTarget(task); setRejectReason(""); }} style={[styles.smallButton, styles.rejectButton]} disabled={busy}>
                        <Text style={styles.smallButtonTextDanger}>Reddet</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </Card>
      )}

      <Modal
        visible={Boolean(rejectTarget)}
        animationType="slide"
        transparent
        onRequestClose={() => { setRejectTarget(null); setRejectReason(""); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Görevi reddet</Text>
            <Text style={styles.modalSubtitle}>{rejectTarget?.title}</Text>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Sebep (opsiyonel)"
              placeholderTextColor={colors.subtle}
              multiline
              style={styles.input}
            />
            <PrimaryButton label="Reddet" onPress={() => void confirmReject()} variant="danger" />
            <Pressable
              onPress={() => { setRejectTarget(null); setRejectReason(""); }}
              style={styles.modalClose}
            >
              <Text style={styles.modalCloseText}>Vazgeç</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function BackLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.backLink}>
      <Feather name="chevron-left" size={16} color={colors.muted} />
      <Text style={styles.backText}>Kullanici listesine dön</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  backText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  actionButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  actionDisabled: { opacity: 0.5 },
  actionText: { fontWeight: "800", fontSize: 13 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statWrap: { flexGrow: 1, flexBasis: "30%" },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 10 },
  muted: { color: colors.muted, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
  taskRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", justifyContent: "space-between", gap: 12 },
  taskCopy: { flex: 1 },
  taskTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  taskMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  taskNote: { color: "#9c6b00", fontSize: 12, marginTop: 4, fontStyle: "italic" },
  pendingActions: { flexDirection: "row", gap: 6, alignItems: "center" },
  smallButton: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  approveButton: { backgroundColor: colors.primary, borderColor: colors.primary },
  rejectButton: { borderColor: colors.danger },
  smallButtonTextLight: { color: "#fff5f3", fontWeight: "800", fontSize: 12 },
  smallButtonTextDanger: { color: colors.danger, fontWeight: "800", fontSize: 12 },
  companyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  companyCopy: { flex: 1 },
  companyName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  companyMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(12,16,24,0.46)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surfaceStrong, padding: 20, borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: 14 },
  modalTitle: { color: colors.text, fontSize: 19, fontWeight: "800" },
  modalSubtitle: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 100,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: "#fffdf9",
    padding: 14,
    color: colors.text,
    textAlignVertical: "top"
  },
  modalClose: { minHeight: 42, alignItems: "center", justifyContent: "center" },
  modalCloseText: { color: colors.textSoft, fontWeight: "700" }
});
