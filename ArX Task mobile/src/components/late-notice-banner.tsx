import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SheetModal } from "@/components/sheet-modal";
import { GhostButton, PrimaryButton, colors } from "@/components/ui";
import { draftLateNotice, logLateNotice } from "@/lib/api";
import { useAppData } from "@/lib/app-data-context";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { estimateTravelSeconds, openSmsComposer, openWhatsAppComposer } from "@/lib/late-notice";
import { hasUsableCoordinates } from "@/lib/location";
import { useUserLocation } from "@/lib/location-context";
import type { Task } from "@/types/business";

const LATE_THRESHOLD_MINUTES = 5;

// R16 — late bot. Watches the next upcoming timed task of today, estimates travel time
// from the current position (OSRM → haversine fallback) and, when the user will be
// ≥5 minutes late, offers to DRAFT a late notice. Nothing is ever sent automatically —
// the user always reviews and taps SMS/WhatsApp themselves.
export function LateNoticeBanner() {
  const { token } = useAuth();
  const { data } = useAppData();
  const { language } = useI18n();
  const { state: locationState } = useUserLocation();

  const [lateMinutes, setLateMinutes] = useState<number | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftVisible, setDraftVisible] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftCompany, setDraftCompany] = useState("");
  const [sendingChannel, setSendingChannel] = useState<string | null>(null);

  const todayKey = new Date().toISOString().slice(0, 10);

  // Next upcoming timed task of today whose company has coordinates.
  const nextTask = useMemo<Task | null>(() => {
    const now = new Date();
    const candidates = data.tasks
      .filter((task) => {
        if (task.status === "done" || task.status === "pending_approval") return false;
        if (task.dueDate !== todayKey || !task.dueTime || !task.companyId) return false;
        const due = new Date(`${task.dueDate}T${task.dueTime}:00`);
        if (Number.isNaN(due.getTime())) return false;
        // Keep tasks still ahead (or just now) — a task already far past isn't "upcoming".
        if (due.getTime() < now.getTime() - 5 * 60 * 1000) return false;
        const company = data.companies.find((item) => item.id === task.companyId);
        return Boolean(company && hasUsableCoordinates(company));
      })
      .sort((left, right) => (left.dueTime ?? "").localeCompare(right.dueTime ?? ""));
    return candidates[0] ?? null;
  }, [data.tasks, data.companies, todayKey]);

  const nextCompany = useMemo(
    () => (nextTask?.companyId ? data.companies.find((item) => item.id === nextTask.companyId) ?? null : null),
    [data.companies, nextTask]
  );

  useEffect(() => {
    let cancelled = false;
    setLateMinutes(null);
    const coords = locationState.coords;
    if (!nextTask || !nextCompany || !coords || !nextTask.dueDate || !nextTask.dueTime) return;

    const due = new Date(`${nextTask.dueDate}T${nextTask.dueTime}:00`);
    if (Number.isNaN(due.getTime())) return;

    estimateTravelSeconds(coords, { latitude: nextCompany.latitude, longitude: nextCompany.longitude })
      .then((etaSeconds) => {
        if (cancelled) return;
        const arrival = Date.now() + etaSeconds * 1000;
        const minutesLate = Math.round((arrival - due.getTime()) / 60000);
        setLateMinutes(minutesLate >= LATE_THRESHOLD_MINUTES ? minutesLate : null);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [nextTask?.id, nextCompany?.id, locationState.coords?.latitude, locationState.coords?.longitude]);

  if (!nextTask || !nextCompany || lateMinutes === null) return null;

  async function prepareDraft() {
    if (!token || !nextTask || lateMinutes === null || drafting) return;
    setDrafting(true);
    try {
      const draft = await draftLateNotice(token, {
        taskId: nextTask.id,
        delayMinutes: lateMinutes,
        language
      });
      setDraftMessage(draft.message);
      setDraftPhone(draft.companyPhone || nextCompany?.phone || "");
      setDraftCompany(draft.companyName || nextCompany?.name || "");
      setDraftVisible(true);
    } catch (error) {
      Alert.alert("Mesaj hazırlanamadı", error instanceof Error ? error.message : "Gecikme mesajı taslağı alınamadı.");
    } finally {
      setDrafting(false);
    }
  }

  async function sendVia(channel: "sms" | "whatsapp") {
    if (!token || !nextTask || sendingChannel) return;
    const message = draftMessage.trim();
    if (!message) return;
    if (!draftPhone.trim()) {
      Alert.alert("Telefon yok", "Bu firma için kayıtlı telefon numarası bulunamadı.");
      return;
    }
    setSendingChannel(channel);
    try {
      if (channel === "sms") {
        await openSmsComposer(draftPhone, message);
      } else {
        await openWhatsAppComposer(draftPhone, message);
      }
      // Log only AFTER the user explicitly chose a channel; the composer still requires
      // their final send tap, we never auto-send.
      await logLateNotice(token, { taskId: nextTask.id, message, channel }).catch(() => undefined);
      setDraftVisible(false);
    } catch (error) {
      Alert.alert("Açılamadı", error instanceof Error ? error.message : "Mesaj uygulaması açılamadı.");
    } finally {
      setSendingChannel(null);
    }
  }

  return (
    <>
      <View style={styles.banner}>
        <View style={styles.bannerIcon}>
          <Feather name="alert-triangle" size={16} color={colors.warning} />
        </View>
        <View style={styles.bannerCopy}>
          <Text style={styles.bannerTitle}>~{lateMinutes} dk geç kalacaksınız</Text>
          <Text style={styles.bannerMeta}>
            {nextCompany.name} · {nextTask.dueTime} · {nextTask.title}
          </Text>
        </View>
        <Pressable onPress={() => void prepareDraft()} style={[styles.bannerButton, drafting && { opacity: 0.5 }]} disabled={drafting}>
          <Text style={styles.bannerButtonText}>{drafting ? "Hazırlanıyor..." : "Müşteriye mesaj hazırla"}</Text>
        </Pressable>
      </View>

      <SheetModal
        visible={draftVisible}
        onClose={() => setDraftVisible(false)}
        title="Gecikme mesajı"
        subtitle={`${draftCompany || nextCompany.name} — göndermeden önce düzenleyebilirsiniz. Mesaj otomatik gönderilmez.`}
        footer={
          <>
            <PrimaryButton
              label={sendingChannel === "sms" ? "SMS açılıyor..." : "SMS ile gönder"}
              onPress={() => void sendVia("sms")}
              disabled={Boolean(sendingChannel) || !draftMessage.trim()}
            />
            <PrimaryButton
              label={sendingChannel === "whatsapp" ? "WhatsApp açılıyor..." : "WhatsApp"}
              variant="secondary"
              onPress={() => void sendVia("whatsapp")}
              disabled={Boolean(sendingChannel) || !draftMessage.trim()}
            />
            <GhostButton label="Vazgeç" onPress={() => setDraftVisible(false)} />
          </>
        }
      >
        <Text style={styles.editLabel}>Düzenle</Text>
        <TextInput
          value={draftMessage}
          onChangeText={setDraftMessage}
          multiline
          style={styles.messageBox}
          placeholder="Gecikme mesajı"
          placeholderTextColor={colors.subtle}
        />
        <Text style={styles.phoneHint}>Alıcı: {draftPhone || "telefon kayıtlı değil"}</Text>
      </SheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(192,139,58,0.35)",
    backgroundColor: "rgba(192,139,58,0.10)",
    padding: 12,
    gap: 10
  },
  bannerIcon: {
    position: "absolute",
    top: 12,
    left: 12,
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "rgba(192,139,58,0.14)",
    alignItems: "center",
    justifyContent: "center"
  },
  bannerCopy: {
    paddingLeft: 40,
    gap: 2
  },
  bannerTitle: {
    color: colors.warning,
    fontSize: 14,
    fontWeight: "700"
  },
  bannerMeta: {
    color: colors.textSoft,
    fontSize: 12,
    lineHeight: 17
  },
  bannerButton: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.warning,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  bannerButtonText: {
    color: "#1a1408",
    fontSize: 13,
    fontWeight: "700"
  },
  editLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  messageBox: {
    minHeight: 120,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    color: colors.text,
    fontSize: 14,
    textAlignVertical: "top"
  },
  phoneHint: {
    color: colors.muted,
    fontSize: 12
  }
});
