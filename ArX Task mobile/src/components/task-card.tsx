import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { Chip, PrimaryButton, colors } from "@/components/ui";
import { getEffectiveTaskStatus } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useDictation } from "@/lib/speech-recognition";
import type { Company, Task } from "@/types/business";

const SNOOZE_HOUR_OPTIONS = [1, 2, 4, 24] as const;

export function TaskCard({
  task,
  company,
  onDone,
  onSnooze,
  onAddNote,
  onCancel,
  onOpenRoute,
  onReschedule,
  onAcknowledge
}: {
  task: Task;
  company?: Company | null;
  onDone: (note?: string) => Promise<void> | void;
  onSnooze: (hours: number, reason?: string) => Promise<void> | void;
  onAddNote: (content: string) => Promise<void> | void;
  onCancel: () => Promise<void> | void;
  onOpenRoute?: () => Promise<void> | void;
  onReschedule?: (dueDate: string, dueTime: string | null) => Promise<void> | void;
  onAcknowledge?: () => Promise<void> | void;
}) {
  const { language } = useI18n();
  const [modalVisible, setModalVisible] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [completionModalVisible, setCompletionModalVisible] = useState(false);
  const [completionNote, setCompletionNote] = useState("");
  const [submittingCompletion, setSubmittingCompletion] = useState(false);
  const [rescheduleVisible, setRescheduleVisible] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [reschedulingNow, setReschedulingNow] = useState(false);
  const [overflowVisible, setOverflowVisible] = useState(false);
  const [snoozeVisible, setSnoozeVisible] = useState(false);
  const [snoozeHours, setSnoozeHours] = useState<number>(1);
  const [snoozeReason, setSnoozeReason] = useState("");
  const [snoozingNow, setSnoozingNow] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const snoozeDictation = useDictation(language, (text) =>
    setSnoozeReason((current) => (current ? `${current} ${text}` : text))
  );
  const effectiveStatus = getEffectiveTaskStatus(task);
  const isPending = task.status === "pending_approval";
  const isOverdue = effectiveStatus === "overdue";
  const isRejected = Boolean(task.lastRejectedAt) && task.status !== "done" && task.status !== "pending_approval";

  const priorityLabel = task.priority === "high" ? "Yüksek" : task.priority === "low" ? "Düşük" : "Orta";
  // Kişi/firma ayrımı: firma varsa firma adı, yoksa AI'dan gelen contactPersonName,
  // hiçbiri yoksa "Kişisel" etiketi.
  const scopeLabel = company?.name ?? task.contactPersonName ?? "Kişisel";
  const isPersonContact = !company && Boolean(task.contactPersonName);
  // Tarihi olan görev "tarih saat" gösterir; tarihsiz (zamansız) görev net biçimde
  // "Tarihsiz" okunur.
  const dueLabel = task.dueDate ? [task.dueDate, task.dueTime].filter(Boolean).join(" ") : "Tarihsiz";
  const reminderLabel = task.reminderInterval ?? "Hatırlatma kapalı";

  const statusBadge = effectiveStatus === "done"
    ? { label: "Tamamlandı", tone: "success" as const }
    : effectiveStatus === "overdue"
      ? { label: "Gecikti", tone: "danger" as const }
      : isPending
        ? { label: "Onay bekliyor", tone: "warning" as const }
        : null;

  async function submitCompletion() {
    if (submittingCompletion) return;
    setSubmittingCompletion(true);
    try {
      await onDone(completionNote);
      setCompletionModalVisible(false);
      setCompletionNote("");
    } finally {
      setSubmittingCompletion(false);
    }
  }

  async function submitReschedule() {
    if (reschedulingNow || !rescheduleDate || !onReschedule) return;
    setReschedulingNow(true);
    try {
      await onReschedule(rescheduleDate, rescheduleTime || null);
      setRescheduleVisible(false);
      setRescheduleDate("");
      setRescheduleTime("");
    } finally {
      setReschedulingNow(false);
    }
  }

  async function submitSnooze() {
    if (snoozingNow) return;
    setSnoozingNow(true);
    try {
      await onSnooze(snoozeHours, snoozeReason.trim() || undefined);
      setSnoozeVisible(false);
      setSnoozeReason("");
      setSnoozeHours(1);
    } finally {
      setSnoozingNow(false);
    }
  }

  // Assigned task not yet acknowledged → the "accept" step comes before any other action.
  const needsAcknowledge = Boolean(task.assignedByUserId) && !task.acknowledgedAt && task.status !== "done" && Boolean(onAcknowledge);

  return (
    <Animated.View style={styles.card} entering={FadeInDown.springify().damping(18).mass(0.6)}>
      <View style={styles.headerRow}>
        <View style={styles.scopeWrap}>
          {isPersonContact ? <Feather name="user" size={11} color={colors.muted} /> : null}
          <Text style={styles.scopeLabel} numberOfLines={1}>{scopeLabel}</Text>
        </View>
        {statusBadge ? <Chip label={statusBadge.label} tone={statusBadge.tone} /> : null}
      </View>

      <Text style={styles.title}>{task.title}</Text>
      <Text style={styles.metaLine}>
        {priorityLabel} öncelik · {dueLabel}
      </Text>

      {task.description ? <Text style={styles.description}>{task.description}</Text> : null}

      {isPending && task.completionRequestedNote ? (
        <View style={styles.calloutWarning}>
          <Text style={styles.calloutLabel}>Gönderdiğiniz not</Text>
          <Text style={styles.calloutText}>{task.completionRequestedNote}</Text>
        </View>
      ) : null}
      {task.lastRejectedAt && task.status !== "done" && task.status !== "pending_approval" ? (
        <View style={styles.calloutDanger}>
          <Text style={styles.calloutLabelDanger}>Reddedildi</Text>
          {task.lastRejectionReason ? <Text style={styles.calloutText}>{task.lastRejectionReason}</Text> : null}
        </View>
      ) : null}

      <View style={styles.infoList}>
        <InfoRow icon="clock" label="Zaman" value={task.timeWindow ?? dueLabel} />
        <InfoRow icon="bell" label="Hatırlatma" value={reminderLabel} />
      </View>

      {task.moduleIds.length ? (
        <View style={styles.moduleWrap}>
          {task.moduleIds.map((moduleId) => (
            <Chip key={moduleId} label={moduleId} />
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        {needsAcknowledge ? (
          <Pressable
            onPress={async () => {
              if (acknowledging || !onAcknowledge) return;
              setAcknowledging(true);
              try {
                await onAcknowledge();
              } finally {
                setAcknowledging(false);
              }
            }}
            style={[styles.primaryAction, acknowledging && styles.actionDisabled]}
            disabled={acknowledging}
          >
            <Feather name="user-check" size={14} color="#fff" />
            <Text style={styles.primaryActionText}>{acknowledging ? "Kabul ediliyor..." : "Görevi kabul et"}</Text>
          </Pressable>
        ) : task.status === "done" ? (
          onOpenRoute ? (
            <Pressable onPress={() => void Promise.resolve(onOpenRoute()).catch(() => undefined)} style={styles.secondaryAction}>
              <Feather name="map-pin" size={14} color={colors.textSoft} />
              <Text style={styles.secondaryActionText}>Rota</Text>
            </Pressable>
          ) : null
        ) : isRejected ? (
          <Pressable onPress={() => setCompletionModalVisible(true)} style={styles.primaryAction}>
            <Feather name="check" size={14} color="#fff" />
            <Text style={styles.primaryActionText}>Tamam</Text>
          </Pressable>
        ) : isOverdue ? (
          <>
            {onReschedule ? (
              <Pressable
                onPress={() => {
                  setRescheduleDate(task.dueDate ?? "");
                  setRescheduleTime(task.dueTime ?? "");
                  setRescheduleVisible(true);
                }}
                style={styles.primaryAction}
              >
                <Feather name="calendar" size={14} color="#fff" />
                <Text style={styles.primaryActionText}>Yeniden zamanla</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => void onCancel()} style={styles.ghostAction}>
              <Text style={styles.dangerActionText}>Sil</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => { if (!isPending) setCompletionModalVisible(true); }}
              style={[styles.primaryAction, isPending && styles.actionDisabled]}
              disabled={isPending}
            >
              <Feather name="check" size={14} color="#fff" />
              <Text style={styles.primaryActionText}>{isPending ? "Onay bekleniyor" : "Tamam"}</Text>
            </Pressable>
            <Pressable onPress={() => setOverflowVisible(true)} style={styles.iconAction}>
              <Feather name="more-horizontal" size={18} color={colors.textSoft} />
            </Pressable>
          </>
        )}
      </View>

      <Modal visible={overflowVisible} transparent animationType="fade" onRequestClose={() => setOverflowVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOverflowVisible(false)}>
          <View style={styles.menuSheet}>
            <MenuItem icon="clock" label="Ertele" onPress={() => { setOverflowVisible(false); setSnoozeVisible(true); }} />
            <MenuItem icon="edit-3" label="Not ekle" onPress={() => { setOverflowVisible(false); setModalVisible(true); }} />
            {onOpenRoute ? (
              <MenuItem icon="map-pin" label="Rota aç" onPress={() => { setOverflowVisible(false); void Promise.resolve(onOpenRoute()).catch(() => undefined); }} />
            ) : null}
            <MenuItem icon="x" label="Görevi iptal et" danger onPress={() => { setOverflowVisible(false); void onCancel(); }} />
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={rescheduleVisible}
        animationType="slide"
        transparent
        onRequestClose={() => { setRescheduleVisible(false); setRescheduleDate(""); setRescheduleTime(""); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Yeniden zamanla</Text>
            <Text style={styles.modalSubtitle}>
              Tarih: YYYY-AA-GG · Saat: SS:DD (opsiyonel). Görev tekrar açık duruma döner.
            </Text>
            <TextInput
              value={rescheduleDate}
              onChangeText={setRescheduleDate}
              placeholder="2026-06-10"
              placeholderTextColor={colors.subtle}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              style={styles.input}
            />
            <TextInput
              value={rescheduleTime}
              onChangeText={setRescheduleTime}
              placeholder="14:30"
              placeholderTextColor={colors.subtle}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              style={styles.input}
            />
            <PrimaryButton
              label={reschedulingNow ? "Kaydediliyor..." : "Tarihi güncelle"}
              onPress={() => void submitReschedule()}
              loading={reschedulingNow}
              disabled={!rescheduleDate}
            />
            <Pressable
              onPress={() => { setRescheduleVisible(false); setRescheduleDate(""); setRescheduleTime(""); }}
              style={styles.modalClose}
            >
              <Text style={styles.modalCloseText}>Vazgeç</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={snoozeVisible}
        animationType="slide"
        transparent
        onRequestClose={() => { setSnoozeVisible(false); setSnoozeReason(""); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Görevi ertele</Text>
            <Text style={styles.modalSubtitle}>Kaç saat erteleneceğini seçin, isterseniz sebep ekleyin.</Text>
            <View style={styles.snoozeHourRow}>
              {SNOOZE_HOUR_OPTIONS.map((hours) => (
                <Pressable
                  key={hours}
                  onPress={() => setSnoozeHours(hours)}
                  style={[styles.snoozeHourChip, snoozeHours === hours && styles.snoozeHourChipActive]}
                >
                  <Text style={[styles.snoozeHourText, snoozeHours === hours && styles.snoozeHourTextActive]}>
                    {hours === 24 ? "1 gün" : `${hours} saat`}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.snoozeReasonRow}>
              <TextInput
                value={snoozeReason}
                onChangeText={setSnoozeReason}
                placeholder="Sebep (opsiyonel) — örn. müşteri müsait değil"
                placeholderTextColor={colors.subtle}
                multiline
                style={[styles.noteBox, styles.snoozeReasonInput]}
              />
              {snoozeDictation.available ? (
                <Pressable
                  onPress={() => void snoozeDictation.toggle()}
                  style={[styles.micButton, snoozeDictation.dictating && styles.micButtonActive]}
                >
                  <Feather name={snoozeDictation.dictating ? "mic-off" : "mic"} size={16} color={snoozeDictation.dictating ? "#fff" : colors.textSoft} />
                </Pressable>
              ) : null}
            </View>
            <PrimaryButton
              label={snoozingNow ? "Erteleniyor..." : `${snoozeHours === 24 ? "1 gün" : `${snoozeHours} saat`} ertele`}
              onPress={() => void submitSnooze()}
              loading={snoozingNow}
            />
            <Pressable
              onPress={() => { setSnoozeVisible(false); setSnoozeReason(""); }}
              style={styles.modalClose}
            >
              <Text style={styles.modalCloseText}>Vazgeç</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={completionModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => { setCompletionModalVisible(false); setCompletionNote(""); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Görevi tamamla</Text>
            <Text style={styles.modalSubtitle}>
              Yöneticiye iletmek istediğiniz isteğe bağlı bir açıklama girebilirsiniz.
            </Text>
            {task.requirePhotoProof ? (
              <View style={styles.calloutWarning}>
                <Text style={styles.calloutLabel}>Fotoğraf kanıtı</Text>
                <Text style={styles.calloutText}>
                  Bu görev fotoğraf kanıtı istiyor. Gönderdiğinizde kamera açılacak.
                </Text>
              </View>
            ) : null}
            <TextInput
              value={completionNote}
              onChangeText={setCompletionNote}
              placeholder="Not (admin görür) — opsiyonel"
              placeholderTextColor={colors.subtle}
              multiline
              style={styles.noteBox}
            />
            <PrimaryButton
              label={submittingCompletion ? "Gönderiliyor..." : "Onay isteği gönder"}
              onPress={() => void submitCompletion()}
              loading={submittingCompletion}
            />
            <Pressable
              onPress={() => { setCompletionModalVisible(false); setCompletionNote(""); }}
              style={styles.modalClose}
            >
              <Text style={styles.modalCloseText}>Vazgeç</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Hızlı not</Text>
            <Text style={styles.modalSubtitle}>Bu görevin bağlamına kısa bir saha notu ekleyin.</Text>
            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Notunuzu yazın"
              placeholderTextColor={colors.subtle}
              multiline
              style={styles.noteBox}
            />
            <PrimaryButton
              label="Notu kaydet"
              onPress={async () => {
                await onAddNote(noteDraft || "Mobil uygulamadan hızlı not eklendi.");
                setNoteDraft("");
                setModalVisible(false);
              }}
            />
            <Pressable
              onPress={() => {
                setModalVisible(false);
                setNoteDraft("");
              }}
              style={styles.modalClose}
            >
              <Text style={styles.modalCloseText}>Vazgeç</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Animated.View>
  );
}

function InfoRow({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon} size={13} color={colors.muted} style={styles.infoIcon} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function MenuItem({ icon, label, onPress, danger }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}>
      <Feather name={icon} size={15} color={danger ? colors.danger : colors.textSoft} />
      <Text style={[styles.menuItemText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 14,
    elevation: 6
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  scopeWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1
  },
  scopeLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    flexShrink: 1
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
    letterSpacing: -0.2
  },
  metaLine: {
    color: colors.muted,
    fontSize: 12,
    marginTop: -4
  },
  description: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 19
  },
  calloutWarning: {
    backgroundColor: "rgba(192,139,58,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(192,139,58,0.24)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3
  },
  calloutDanger: {
    backgroundColor: "rgba(197,74,68,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(197,74,68,0.24)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3
  },
  calloutLabel: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  calloutLabelDanger: {
    color: colors.danger,
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  calloutText: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 18
  },
  infoList: {
    gap: 4,
    paddingTop: 2
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  infoIcon: {
    width: 14
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 12,
    width: 78
  },
  infoValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500",
    flex: 1
  },
  moduleWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4
  },
  primaryAction: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12
  },
  primaryActionText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600"
  },
  secondaryAction: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12
  },
  secondaryActionText: {
    color: colors.textSoft,
    fontSize: 13,
    fontWeight: "500"
  },
  ghostAction: {
    minHeight: 38,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  dangerActionText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "500"
  },
  iconAction: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center"
  },
  actionDisabled: {
    opacity: 0.5
  },
  menuSheet: {
    marginTop: "auto",
    backgroundColor: colors.surfaceStrong,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 8,
    paddingBottom: 24
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 8
  },
  menuItemPressed: {
    backgroundColor: colors.surfaceAlt
  },
  menuItemText: {
    color: colors.textSoft,
    fontSize: 14,
    fontWeight: "500"
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end"
  },
  modalCard: {
    backgroundColor: colors.surfaceStrong,
    padding: 18,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 12
  },
  modalTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600"
  },
  modalSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  noteBox: {
    minHeight: 110,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    color: colors.text,
    fontSize: 14,
    textAlignVertical: "top"
  },
  input: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 14
  },
  snoozeHourRow: {
    flexDirection: "row",
    gap: 6
  },
  snoozeHourChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center"
  },
  snoozeHourChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  snoozeHourText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500"
  },
  snoozeHourTextActive: {
    color: colors.text
  },
  snoozeReasonRow: {
    position: "relative"
  },
  snoozeReasonInput: {
    minHeight: 84,
    paddingRight: 46
  },
  micButton: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center"
  },
  micButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  modalClose: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  modalCloseText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500"
  }
});
