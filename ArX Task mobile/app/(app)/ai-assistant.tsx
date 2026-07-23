import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import { AppHeader } from "@/components/app-header";
import { Card, GhostButton, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { useAppData } from "@/lib/app-data-context";
import { useAuth } from "@/lib/auth-context";
import { askAssistant } from "@/lib/api";
import { companyById, formatCurrency, isTaskOpen } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useDictation } from "@/lib/speech-recognition";
import type { LanguageCode } from "@/types/business";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

// R6 — TTS locale per app language.
const TTS_LOCALES: Record<LanguageCode, string> = {
  tr: "tr-TR",
  de: "de-DE",
  en: "en-US",
  ar: "ar-SA",
  fr: "fr-FR",
  nl: "nl-NL"
};

const assistantPrompts = [
  "Hangi firmalar takip bekliyor?",
  "Bekleyen tahsilat toplami nedir?",
  "Bugunun en kritik gorevleri neler?",
  "Mara Market ile ilgili ne var?"
];

export default function AssistantScreen() {
  const { data } = useAppData();
  const { token } = useAuth();
  const { language } = useI18n();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      content: "Merhaba. Mobil asistanda bugun acik isleri, tahsilat riskini ve firma baglamini hizli cevaplarla ozetleyebilirim."
    }
  ]);

  // Which assistant message is currently being read aloud (null → silent).
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const dictation = useDictation(language, (text) =>
    setDraft((current) => (current ? `${current} ${text}` : text))
  );

  const pendingInvoiceTotal = useMemo(
    () => data.invoices.filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.total, 0),
    [data.invoices]
  );

  // Stop any ongoing speech when the screen unmounts.
  useEffect(() => {
    return () => {
      Speech.stop().catch(() => undefined);
    };
  }, []);

  const stopSpeaking = () => {
    Speech.stop().catch(() => undefined);
    setSpeakingId(null);
  };

  const toggleSpeak = (message: ChatMessage) => {
    if (speakingId === message.id) {
      stopSpeaking();
      return;
    }
    Speech.stop().catch(() => undefined);
    setSpeakingId(message.id);
    Speech.speak(message.content, {
      language: TTS_LOCALES[language] ?? "tr-TR",
      onDone: () => setSpeakingId((current) => (current === message.id ? null : current)),
      onStopped: () => setSpeakingId((current) => (current === message.id ? null : current)),
      onError: () => setSpeakingId((current) => (current === message.id ? null : current))
    });
  };

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    // New question interrupts any ongoing read-out.
    stopSpeaking();

    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", content: trimmed }]);
    setDraft("");
    setBusy(true);

    let answer: string;
    try {
      if (!token) throw new Error("not-authenticated");
      // Real, data-grounded AI answer from the backend.
      const response = await askAssistant(token, trimmed, language);
      answer = response.answer?.trim() || answerFromData(trimmed, data, language, pendingInvoiceTotal);
    } catch {
      // Offline or assistant not configured (HTTP 503) → deterministic local summary.
      answer = answerFromData(trimmed, data, language, pendingInvoiceTotal);
    } finally {
      setBusy(false);
    }

    setMessages((current) => [
      ...current,
      { id: `assistant-${Date.now()}-${current.length}`, role: "assistant", content: answer }
    ]);
  };

  return (
    <Screen withTabs>
      <AppHeader title="AI asistan" subtitle="Webdeki yardimci akislarin mobilde hizli, chat-first operasyon ozeti." />

      <Card variant="hero" style={styles.heroCard}>
        <Text style={styles.heroTitle}>Sahada hizli yanit</Text>
        <Text style={styles.heroText}>
          Acik gorevler, tahsilat baskisi, takip gerektiren firmalar ve belirli musteri baglamlari icin anlik ozet al.
        </Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Hazir sorular</Text>
        <View style={styles.promptGrid}>
          {assistantPrompts.map((prompt) => (
            <Pressable key={prompt} onPress={() => ask(prompt)} style={styles.promptCard}>
              <Feather name="star" size={16} color={colors.primary} />
              <Text style={styles.promptText}>{prompt}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Sohbet</Text>
        <View style={styles.chatList}>
          {messages.map((message) => (
            <View key={message.id} style={[styles.bubble, message.role === "user" ? styles.userBubble : styles.assistantBubble]}>
              <View style={styles.bubbleHeader}>
                <Text style={[styles.bubbleRole, message.role === "user" ? styles.userBubbleRole : null]}>
                  {message.role === "user" ? "Siz" : "Asistan"}
                </Text>
                {message.role === "assistant" ? (
                  <Pressable
                    onPress={() => toggleSpeak(message)}
                    style={[styles.speakButton, speakingId === message.id && styles.speakButtonActive]}
                    hitSlop={8}
                  >
                    <Feather
                      name={speakingId === message.id ? "volume-x" : "volume-2"}
                      size={15}
                      color={speakingId === message.id ? "#fff" : colors.muted}
                    />
                  </Pressable>
                ) : null}
              </View>
              <Text style={[styles.bubbleText, message.role === "user" ? styles.userBubbleText : null]}>{message.content}</Text>
            </View>
          ))}
        </View>
        <TextField
          label="Soru"
          value={draft}
          onChangeText={setDraft}
          placeholder="Ornek: Bugun hangi firmalar riskli?"
          multiline
          right={
            dictation.available ? (
              <Pressable
                onPress={() => void dictation.toggle()}
                style={[styles.micButton, dictation.dictating && styles.micButtonActive]}
                hitSlop={8}
              >
                <Feather name={dictation.dictating ? "mic-off" : "mic"} size={16} color={dictation.dictating ? "#fff" : colors.textSoft} />
              </Pressable>
            ) : undefined
          }
        />
        <View style={styles.actions}>
          <PrimaryButton label={busy ? "Yaniti hazirliyor..." : "Sor"} loading={busy} disabled={!draft.trim()} onPress={() => ask(draft)} />
          <GhostButton label="Temizle" onPress={() => { stopSpeaking(); setMessages((current) => current.slice(0, 1)); }} />
        </View>
      </Card>
    </Screen>
  );
}

function answerFromData(question: string, data: ReturnType<typeof useAppData>["data"], language: string, pendingInvoiceTotal: number) {
  const lower = question.toLocaleLowerCase("tr-TR");
  const followUps = data.companies.filter((company) => ["followUp", "waitingPayment", "offerSent"].includes(company.status));
  const openTasks = data.tasks.filter((task) => isTaskOpen(task));

  if (lower.includes("takip") || lower.includes("follow")) {
    return followUps.length
      ? `Takip bekleyen firmalar: ${followUps.map((company) => company.name).join(", ")}.`
      : "Takip bekleyen firma bulunmuyor.";
  }

  if (lower.includes("tahsilat") || lower.includes("odeme") || lower.includes("payment")) {
    return `Bekleyen tahsilat toplami ${formatCurrency(pendingInvoiceTotal, language)} seviyesinde.`;
  }

  if (lower.includes("kritik") || lower.includes("bugun") || lower.includes("gorev")) {
    const summary = openTasks.slice(0, 3).map((task) => task.title).join(", ");
    return summary ? `Bugunun en kritik acik isleri: ${summary}.` : "Bugun icin acik kritik gorev bulunmuyor.";
  }

  const matchedCompany = data.companies.find((company) => lower.includes(company.name.toLocaleLowerCase("tr-TR")));
  if (matchedCompany) {
    const companyTasks = data.tasks.filter((task) => task.companyId === matchedCompany.id && isTaskOpen(task)).length;
    const companyOffers = data.offers.filter((offer) => offer.companyId === matchedCompany.id).length;
    const companyInvoices = data.invoices.filter((invoice) => invoice.companyId === matchedCompany.id && invoice.status !== "paid").length;
    return `${matchedCompany.name} icin ${companyTasks} acik gorev, ${companyOffers} teklif ve ${companyInvoices} odeme bekleyen fatura gorunuyor.`;
  }

  return "Bu soruya uygun hazir ozet bulamadim. Firma adi, takip, tahsilat veya bugun kelimeleriyle daha net sorabilirsiniz.";
}

const styles = StyleSheet.create({
  heroCard: {
    borderColor: colors.border
  },
  heroTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: -0.3
  },
  heroText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2
  },
  promptGrid: {
    gap: 10
  },
  promptCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  promptText: {
    color: colors.text,
    fontWeight: "700",
    flex: 1
  },
  chatList: {
    gap: 12
  },
  bubble: {
    borderRadius: 22,
    padding: 14,
    gap: 6
  },
  assistantBubble: {
    backgroundColor: colors.surfaceAlt
  },
  userBubble: {
    backgroundColor: colors.primary,
    alignSelf: "flex-end",
    maxWidth: "90%"
  },
  bubbleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  bubbleRole: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7
  },
  speakButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceStrong
  },
  speakButtonActive: {
    backgroundColor: colors.primary
  },
  micButton: {
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
  userBubbleRole: {
    color: "#fbe7ea"
  },
  bubbleText: {
    color: colors.text,
    lineHeight: 21
  },
  userBubbleText: {
    color: "#fff7f8"
  },
  actions: {
    gap: 10
  }
});
