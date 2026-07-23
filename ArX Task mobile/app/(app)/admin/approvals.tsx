import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AppHeader } from "@/components/app-header";
import { Card, Chip, EmptyState, PrimaryButton, Screen, colors } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useAppData } from "@/lib/app-data-context";
import { listPendingApprovals } from "@/lib/api";
import type { AdminTaskRow } from "@/types/business";

export default function ApprovalsScreen() {
  const { token } = useAuth();
  const { approveTask, rejectTask } = useAppData();
  const [rows, setRows] = useState<AdminTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [rejectTarget, setRejectTarget] = useState<AdminTaskRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await listPendingApprovals(token);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function approve(row: AdminTaskRow) {
    setBusyIds((current) => [...current, row.task.id]);
    try {
      await approveTask(row.task.userId, row.task.id);
      await load();
    } finally {
      setBusyIds((current) => current.filter((id) => id !== row.task.id));
    }
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    const row = rejectTarget;
    setBusyIds((current) => [...current, row.task.id]);
    try {
      await rejectTask(row.task.userId, row.task.id, rejectReason);
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } finally {
      setBusyIds((current) => current.filter((id) => id !== row.task.id));
    }
  }

  return (
    <Screen withTabs>
      <AppHeader title="Onay Bekleyen Gorevler" subtitle="Saha kullanicilarinin tamamlama isteklerini incele." />
      {loading ? (
        <Card><Text style={styles.muted}>Yukleniyor...</Text></Card>
      ) : rows.length === 0 ? (
        <EmptyState title="Bekleyen istek yok" description="Tamamlama istekleri geldiginde burada gozukur." />
      ) : (
        rows.map((row) => {
          const busy = busyIds.includes(row.task.id);
          return (
            <Card key={row.task.id}>
              <Text style={styles.title}>{row.task.title}</Text>
              <Text style={styles.subtitle}>
                {row.user?.name ?? row.task.userId} · {row.company?.name ?? "Kisisel"}
              </Text>
              {row.task.completionRequestedNote ? (
                <View style={styles.noteBlock}>
                  <Text style={styles.noteLabel}>Kullanicinin notu</Text>
                  <Text style={styles.noteText}>{row.task.completionRequestedNote}</Text>
                </View>
              ) : null}
              <View style={styles.actionRow}>
                <PrimaryButton label={busy ? "..." : "Onayla"} onPress={() => void approve(row)} loading={busy} />
                <Pressable
                  onPress={() => { setRejectTarget(row); setRejectReason(""); }}
                  style={styles.rejectButton}
                >
                  <Text style={styles.rejectText}>Reddet</Text>
                </Pressable>
              </View>
              <Chip
                label={row.task.completionRequestedAt ?? "-"}
                tone="default"
              />
            </Card>
          );
        })
      )}

      <Modal visible={Boolean(rejectTarget)} transparent animationType="slide" onRequestClose={() => { setRejectTarget(null); setRejectReason(""); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Görevi reddet</Text>
            <Text style={styles.modalSubtitle}>{rejectTarget?.task.title}</Text>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Sebep (opsiyonel)"
              placeholderTextColor={colors.subtle}
              multiline
              style={styles.input}
            />
            <PrimaryButton label="Reddet" onPress={() => void confirmReject()} variant="danger" />
            <Pressable onPress={() => { setRejectTarget(null); setRejectReason(""); }} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Vazgeç</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14 },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 4 },
  noteBlock: {
    marginTop: 12,
    backgroundColor: "rgba(240,180,40,0.12)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(240,180,40,0.32)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4
  },
  noteLabel: { color: "#9c6b00", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  noteText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  actionRow: { flexDirection: "row", gap: 12, marginTop: 12, alignItems: "center" },
  rejectButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: "center",
    justifyContent: "center"
  },
  rejectText: { color: colors.danger, fontWeight: "800" },
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
