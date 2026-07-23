import { useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AppHeader } from "@/components/app-header";
import { Card, Chip, EmptyState, GhostButton, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { useAppData } from "@/lib/app-data-context";
import { localizeReminderLabel, localizeTaskTypeLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useUserLocation } from "@/lib/location-context";
import { canRouteToCompany, formatDistanceLabel, openCompanyRoute, rankResolutionCandidates } from "@/lib/location";
import type { AiCaptureResponse, AiCompanyDraftRequest, Company } from "@/types/business";
import {
  isSpeechRecognitionAvailable,
  isSpeechRecognitionUnsupportedInExpoGo,
  requestSpeechRecognitionPermissions,
  startSpeechRecognition,
  stopSpeechRecognition,
  useSpeechRecognitionEventCompat
} from "@/lib/speech-recognition";

type PendingCapture = {
  language: string;
  sourceText: string;
  sourceType: "voice" | "text";
};

type PendingAddressResolution = NonNullable<AiCaptureResponse["addressResolutions"]>[number];

type DraftCompanyForm = {
  detectedName: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  contactPerson: string;
};

export default function CaptureScreen() {
  const router = useRouter();
  const { analyzeCapture, lastCapture } = useAppData();
  const { language, t } = useI18n();
  const { state: locationState, requestPermission: requestLocationPermission } = useUserLocation();
  const [transcript, setTranscript] = useState("");
  // Finalized portion of the transcript — appended to as the speech recognizer
  // emits isFinal: true segments. Interim results render on top of this prefix
  // so each new phrase doesn't overwrite the previous one.
  const committedTranscriptRef = useRef("");
  const [recording, setRecording] = useState(false);
  const [captureSourceType, setCaptureSourceType] = useState<"voice" | "text">("text");
  const [submitting, setSubmitting] = useState(false);
  const [resolutionSubmitting, setResolutionSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pendingCapture, setPendingCapture] = useState<PendingCapture | null>(null);
  const [resolutionResponse, setResolutionResponse] = useState<AiCaptureResponse | null>(null);
  const [addressResolutions, setAddressResolutions] = useState<PendingAddressResolution[] | null>(null);
  const [draftCompanies, setDraftCompanies] = useState<DraftCompanyForm[]>([]);
  const [resolvedDrafts, setResolvedDrafts] = useState<AiCompanyDraftRequest[]>([]);

  useSpeechRecognitionEventCompat("start", () => setRecording(true));
  useSpeechRecognitionEventCompat("end", () => setRecording(false));
  useSpeechRecognitionEventCompat("result", (event) => {
    const fragment = event.results?.[0]?.transcript?.trim();
    if (!fragment) return;

    setCaptureSourceType("voice");
    setError("");

    if (event.isFinal) {
      // Finalized phrase → commit it and clear the interim slot.
      const base = committedTranscriptRef.current;
      const next = base ? `${base} ${fragment}` : fragment;
      committedTranscriptRef.current = next;
      setTranscript(next);
    } else {
      // Interim → render on top of whatever has been committed so far.
      const base = committedTranscriptRef.current;
      setTranscript(base ? `${base} ${fragment}` : fragment);
    }
  });
  useSpeechRecognitionEventCompat("error", (event) => {
    setRecording(false);
    if (event.error === "no-speech") {
      setError("Ses algılanamadı. Mikrofona daha yakın konuşmayı veya cihazınızda Google konuşma servisini güncel tutmayı deneyin. Hâlâ olmuyorsa metni elle girin.");
      return;
    }
    if (event.error === "audio-capture" || event.error === "not-allowed") {
      setError("Mikrofon erişimi yok. Sistem ayarlarından uygulamaya mikrofon izni verin.");
      return;
    }
    if (event.error === "network") {
      setError("Ağ hatası. Konuşma tanıma için internet bağlantısı gerekli.");
      return;
    }
    setError(event.error ? `Mikrofon hatası: ${event.error}` : "Mikrofon başlatılamadı. İzinleri kontrol edin.");
  });

  const captureResponse = resolutionResponse ?? lastCapture;
  const previewTasks = useMemo(() => captureResponse?.analysis.tasks ?? [], [captureResponse]);
  const resolutionPrompt = resolutionResponse?.companyResolution ?? null;
  const needsResolution = Boolean(resolutionResponse?.requiresCompanyResolution && resolutionPrompt);
  const analysisLanguage = captureResponse?.analysis.detectedLanguage ?? language;
  const rankedCandidates = useMemo(
    () => rankResolutionCandidates(resolutionPrompt?.candidates ?? [], locationState.coords),
    [locationState.coords, resolutionPrompt?.candidates]
  );
  const recommendedCandidate = rankedCandidates[0] ?? null;
  const alternativeCandidates = recommendedCandidate ? rankedCandidates.slice(1) : [];
  const createdCompany = useMemo<Company | null>(() => {
    if (!captureResponse?.created.companyId) return null;
    return captureResponse.snapshot.companies.find((company) => company.id === captureResponse.created.companyId) ?? null;
  }, [captureResponse]);
  const currentAddressResolution = addressResolutions?.[0] ?? null;
  const currentDraftCompany = currentAddressResolution
    ? draftCompanies.find((item) => item.detectedName === currentAddressResolution.detectedName) ?? null
    : null;

  const syncDraftCompanies = (prompts: PendingAddressResolution[]) => {
    setDraftCompanies((current) =>
      prompts.map((prompt) => {
        const existing = current.find((item) => item.detectedName === prompt.detectedName);
        return (
          existing ?? {
            detectedName: prompt.detectedName,
            name: prompt.detectedName,
            address: "",
            phone: "",
            email: "",
            contactPerson: ""
          }
        );
      })
    );
  };

  const applyAddressResolutionResponse = (response: AiCaptureResponse) => {
    const prompts =
      response.addressResolutions?.length
        ? response.addressResolutions
        : response.addressResolution
          ? [response.addressResolution]
          : [];

    if (prompts.length > 0) {
      setPendingCapture((current) => current);
      setResolutionResponse(null);
      setAddressResolutions(prompts);
      syncDraftCompanies(prompts);
      return true;
    }

    setAddressResolutions(null);
    setDraftCompanies([]);
    setResolvedDrafts([]);
    return false;
  };

  const updateDraftCompany = (detectedName: string, patch: Partial<DraftCompanyForm>) => {
    setDraftCompanies((current) =>
      current.map((item) => (item.detectedName === detectedName ? { ...item, ...patch } : item))
    );
  };

  const toggleRecording = async () => {
    if (isSpeechRecognitionUnsupportedInExpoGo()) {
      setError("Ses tanima Expo Go icinde kullanilamiyor. Bu ozellik icin development build gerekli.");
      return;
    }

    const available = await isSpeechRecognitionAvailable();
    if (!available) {
      setError("Bu cihazda konusma tanima kullanilamiyor.");
      return;
    }

    if (recording) {
      await stopSpeechRecognition();
      return;
    }

    const permission = await requestSpeechRecognitionPermissions();
    if (!permission.granted) {
      setError("Mikrofon ve konusma izni gerekli.");
      return;
    }

    // Anchor new dictation to whatever is already in the field so the user can
    // keep speaking after manual edits without losing the prefix.
    committedTranscriptRef.current = transcript;
    setError("");
    await startSpeechRecognition({
      lang: language,
      interimResults: true,
      // continuous: keep listening through natural pauses instead of bailing
      // after the first silent gap — STT was ending too early on Android.
      continuous: true,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: false
    });
  };

  const submit = async () => {
    const sourceText = transcript.trim();
    if (!sourceText) {
      setError("Once metin girin veya ses kaydi baslatin.");
      return;
    }

    // Analiz tetiklenince ses kaydını otomatik durdur — kullanıcı analizden sonra
    // mikrofonu elle kapatmak zorunda kalmasın. Manuel mikrofon butonu bundan etkilenmez.
    if (recording) {
      await stopSpeechRecognition();
      setRecording(false);
    }

    const sourceType = captureSourceType;
    setSubmitting(true);
    setError("");
    setResolvedDrafts([]);
    try {
      const response = await analyzeCapture(sourceText, sourceType, language);
      if (response.requiresCompanyResolution && response.companyResolution) {
        setPendingCapture({ sourceText, sourceType, language });
        setResolutionResponse(response);
        setAddressResolutions(null);
        setDraftCompanies([]);
      } else if (response.requiresAddressResolution && applyAddressResolutionResponse(response)) {
        setPendingCapture({ sourceText, sourceType, language });
      } else {
        setPendingCapture(null);
        setResolutionResponse(null);
        setAddressResolutions(null);
        setDraftCompanies([]);
        setResolvedDrafts([]);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "AI analizi yapilamadi. Metni duzenleyip tekrar deneyin.");
    } finally {
      setSubmitting(false);
    }
  };

  const resolveCompany = async (existingCompanyId?: string) => {
    if (!pendingCapture) {
      return;
    }

    setResolutionSubmitting(true);
    setError("");
    setResolvedDrafts([]);
    try {
      const response = await analyzeCapture(pendingCapture.sourceText, pendingCapture.sourceType, pendingCapture.language, {
        createSeparateCompany: !existingCompanyId,
        existingCompanyId: existingCompanyId ?? null
      });
      if (response.requiresCompanyResolution && response.companyResolution) {
        setResolutionResponse(response);
        setAddressResolutions(null);
        setDraftCompanies([]);
      } else if (response.requiresAddressResolution && applyAddressResolutionResponse(response)) {
      } else {
        setResolutionResponse(null);
        setAddressResolutions(null);
        setDraftCompanies([]);
        setResolvedDrafts([]);
        setPendingCapture(null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Firma eslestirmesi tamamlanamadi. Tekrar deneyin.");
    } finally {
      setResolutionSubmitting(false);
    }
  };

  const closeResolution = () => {
    setResolutionResponse(null);
  };

  const submitAddressResolution = async () => {
    if (!pendingCapture) {
      return;
    }

    if (!currentDraftCompany) {
      setError("Firma adres cozumu icin aktif bir kart bulunamadi.");
      return;
    }

    if (!currentDraftCompany.name.trim() || !currentDraftCompany.address.trim()) {
      setError(`"${currentDraftCompany.detectedName}" icin firma adi ve adres gerekli.`);
      return;
    }

    setResolutionSubmitting(true);
    setError("");
    try {
      const currentDraftPayload: AiCompanyDraftRequest = {
        detectedName: currentDraftCompany.detectedName,
        name: currentDraftCompany.name.trim(),
        address: currentDraftCompany.address.trim(),
        phone: currentDraftCompany.phone.trim() || null,
        email: currentDraftCompany.email.trim() || null,
        contactPerson: currentDraftCompany.contactPerson.trim() || null
      };
      const normalizeDraftKey = (value?: string | null) => (value ?? "").trim().toLowerCase();
      const currentKey = normalizeDraftKey(currentDraftPayload.detectedName);
      const mergedDrafts: AiCompanyDraftRequest[] = [
        ...resolvedDrafts.filter((item) => normalizeDraftKey(item.detectedName) !== currentKey),
        currentDraftPayload
      ];

      const response = await analyzeCapture(
        pendingCapture.sourceText,
        pendingCapture.sourceType,
        pendingCapture.language,
        { createSeparateCompany: true },
        mergedDrafts
      );
      if (response.requiresCompanyResolution && response.companyResolution) {
        setResolutionResponse(response);
        setAddressResolutions(null);
        setDraftCompanies([]);
        setResolvedDrafts([]);
      } else if (response.requiresAddressResolution && applyAddressResolutionResponse(response)) {
        setResolvedDrafts(mergedDrafts);
      } else {
        setResolutionResponse(null);
        setAddressResolutions(null);
        setDraftCompanies([]);
        setResolvedDrafts([]);
        setPendingCapture(null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Firma kaydi olusturulamadi. Tekrar deneyin.");
    } finally {
      setResolutionSubmitting(false);
    }
  };

  const openRouteForCompany = async (company: Company | null) => {
    if (!company) {
      setError("Rota acmak icin firma bulunamadi.");
      return;
    }

    try {
      let origin = locationState.coords;
      if (!origin && !locationState.granted && locationState.canAskAgain) {
        await requestLocationPermission();
        origin = locationState.coords;
      }

      await openCompanyRoute(company, origin);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Google Maps acilamadi.");
    }
  };

  return (
    <Screen withTabs>
      <AppHeader title={t("capture.title")} subtitle="Ses notunu operasyon verisine çeviren AI giriş katmanı." />

      <Card>
        <View style={styles.heroRow}>
          <Pressable onPress={() => void toggleRecording()} style={[styles.micButton, recording ? styles.micButtonActive : null]}>
            <Feather name={recording ? "square" : "mic"} size={22} color="#fff" />
          </Pressable>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>{recording ? "Dinleniyor…" : "Voice inbox hazır"}</Text>
            <Text style={styles.heroText}>
              {recording
                ? "Konuşmanız bittiğinde tekrar dokunup kaydı durdurun."
                : "Saha notunuzu konuşarak veya yapıştırarak görev akışına dönüştürün."}
            </Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Ham girdi</Text>
        <Text style={styles.sectionHint}>AI isleyicisine gidecek metni burada duzenleyin.</Text>
        <TextField
          label="Transkript"
          value={transcript}
          onChangeText={(value) => {
            setTranscript(value);
            // Manual edit becomes the new committed baseline so further
            // dictation appends to what the user actually sees.
            committedTranscriptRef.current = value;
            setCaptureSourceType("text");
          }}
          multiline
          style={styles.transcriptField}
          placeholder={t("capture.placeholder")}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <GhostButton label={recording ? "Kaydi durdur" : "Kaydi baslat"} onPress={() => void toggleRecording()} />
          <PrimaryButton label={t("actions.analyze")} onPress={() => void submit()} loading={submitting} />
          <GhostButton
            label="Temizle"
            onPress={() => {
              setTranscript("");
              committedTranscriptRef.current = "";
              setError("");
              setPendingCapture(null);
              setResolutionResponse(null);
              setAddressResolutions(null);
              setDraftCompanies([]);
              setResolvedDrafts([]);
              setCaptureSourceType("text");
            }}
          />
        </View>
      </Card>

      <Card>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryCopy}>
            <Text style={styles.sectionTitle}>Analiz ozeti</Text>
            <Text style={styles.sectionHint}>
              {needsResolution
                ? "Kayitlari olusturmadan once firma eslestirmesini tamamlayin."
                : "AI tarafinda olusacak kayitlarin hizli onizlemesi"}
            </Text>
          </View>
          {captureResponse ? (
            <Chip
              label={
                needsResolution
                  ? `${previewTasks.length} taslak gorev`
                  : `${captureResponse.created.taskIds.length}/${previewTasks.length} gorev`
              }
              tone={needsResolution ? "warning" : "success"}
            />
          ) : null}
        </View>
        {!captureResponse ? (
          <EmptyState title="Henuz analiz yok" description="Bir ses notu veya metin gonderdiginde olusacak yapilar burada gorunur." />
        ) : (
          <>
            {needsResolution ? (
              <View style={styles.resolutionBanner}>
                <Feather name="git-merge" size={16} color={colors.primary} />
                <Text style={styles.resolutionBannerText}>Mevcut firma eslestirmesi secimi bekleniyor.</Text>
              </View>
            ) : null}
            <View style={styles.summaryStrip}>
              <InfoBlock label="Algilanan firma" value={getCaptureAnalysisCompanyLabel(captureResponse.analysis)} />
              <InfoBlock
                label="Moduller"
                value={captureResponse.analysis.modules.map((module) => localizeTaskTypeLabel(module.type, analysisLanguage)).join(", ") || "-"}
              />
            </View>
            <View style={styles.previewList}>
              {previewTasks.map((task, index) => (
                <View key={`${task.title}-${index}`} style={styles.previewTask}>
                  <View style={styles.previewTaskTop}>
                    <Text style={styles.previewTaskTitle}>{task.title}</Text>
                    <Chip
                      label={
                        getCaptureTaskCompanyLabel(task, captureResponse.analysis)
                          ?? (task.type === "custom" || task.type === "todo" ? "Kisisel" : "Is gorevi")
                      }
                    />
                  </View>
                  <Text style={styles.previewTaskDesc}>{task.description || "Aciklama yok."}</Text>
                  <View style={styles.previewChips}>
                    <Chip label={localizeTaskTypeLabel(task.type, analysisLanguage)} />
                    <Chip label={task.dueDate ? `${task.dueDate} ${task.dueTime ?? ""}`.trim() : "Tarihsiz"} />
                    <Chip label={localizeReminderLabel(task.reminderRule, analysisLanguage)} tone="warning" />
                  </View>
                </View>
              ))}
            </View>
            {!needsResolution && captureResponse.created.companyId ? (
              <View style={styles.createdBox}>
                <Text style={styles.createdTitle}>Kayit olusturuldu</Text>
                <Text style={styles.createdText}>
                  {captureResponse.created.taskIds.length} gorev, {captureResponse.created.moduleIds.length} modul ve {captureResponse.created.reminderIds.length} reminder kaydi tamamlandi.
                </Text>
                <PrimaryButton label="Firmayi ac" onPress={() => router.push({ pathname: "/(app)/companies/[id]", params: { id: captureResponse.created.companyId! } })} />
                {createdCompany && canRouteToCompany(createdCompany) ? (
                  <GhostButton label="Rotayi ac" onPress={() => void openRouteForCompany(createdCompany)} />
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </Card>

      <Modal visible={needsResolution} transparent animationType="slide" onRequestClose={closeResolution}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIcon}>
                <Feather name="briefcase" size={18} color={colors.primary} />
              </View>
              <View style={styles.modalCopy}>
                <Text style={styles.modalTitle}>Firma eslestirmesini tamamla</Text>
                <Text style={styles.modalText}>{resolutionPrompt?.message}</Text>
              </View>
            </View>

            <ScrollView style={styles.modalList} contentContainerStyle={styles.modalListContent} showsVerticalScrollIndicator={false}>
              {recommendedCandidate ? (
                <View style={styles.candidateSection}>
                  <Text style={styles.candidateSectionTitle}>AI onerisi</Text>
                  <CandidateCard
                    candidate={recommendedCandidate}
                    recommended
                    disabled={resolutionSubmitting}
                    onPress={() => void resolveCompany(recommendedCandidate.id)}
                  />
                </View>
              ) : null}

              {alternativeCandidates.length > 0 ? (
                <View style={styles.candidateSection}>
                  <Text style={styles.candidateSectionTitle}>Diger eslesen kayitlar</Text>
                  {alternativeCandidates.map((candidate) => (
                    <CandidateCard
                      key={candidate.id}
                      candidate={candidate}
                      disabled={resolutionSubmitting}
                      onPress={() => void resolveCompany(candidate.id)}
                    />
                  ))}
                </View>
              ) : null}
            </ScrollView>

            <PrimaryButton
              label="Ayri yeni kayit ac"
              onPress={() => void resolveCompany()}
              loading={resolutionSubmitting}
              variant="secondary"
            />
            <GhostButton label="Daha sonra bak" onPress={closeResolution} />
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(currentAddressResolution && currentDraftCompany)} transparent animationType="slide" onRequestClose={() => { setAddressResolutions(null); setDraftCompanies([]); setResolvedDrafts([]); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIcon}>
                <Feather name="map-pin" size={18} color={colors.primary} />
              </View>
              <View style={styles.modalCopy}>
                <Text style={styles.modalTitle}>Firma adresini tamamla</Text>
                <Text style={styles.modalText}>
                  {currentAddressResolution?.message ?? ""}
                </Text>
              </View>
            </View>

            <ScrollView style={styles.modalList} contentContainerStyle={styles.modalListContent} showsVerticalScrollIndicator={false}>
              {currentAddressResolution && currentDraftCompany ? (
                <View key={currentAddressResolution.detectedName} style={styles.addressCard}>
                  <Text style={styles.addressCardTitle}>{currentAddressResolution.detectedName}</Text>
                  <Text style={styles.addressCardText}>{currentAddressResolution.message}</Text>
                  <TextField
                    label="Firma adi"
                    value={currentDraftCompany.name}
                    onChangeText={(value) => updateDraftCompany(currentAddressResolution.detectedName, { name: value })}
                  />
                  <TextField
                    label="Adres"
                    value={currentDraftCompany.address}
                    onChangeText={(value) => updateDraftCompany(currentAddressResolution.detectedName, { address: value })}
                    multiline
                    style={styles.addressField}
                  />
                  <TextField
                    label="Telefon"
                    value={currentDraftCompany.phone}
                    onChangeText={(value) => updateDraftCompany(currentAddressResolution.detectedName, { phone: value })}
                    keyboardType="phone-pad"
                  />
                  <TextField
                    label="Ilgili kisi"
                    value={currentDraftCompany.contactPerson}
                    onChangeText={(value) => updateDraftCompany(currentAddressResolution.detectedName, { contactPerson: value })}
                  />
                  <TextField
                    label="E-posta"
                    value={currentDraftCompany.email}
                    onChangeText={(value) => updateDraftCompany(currentAddressResolution.detectedName, { email: value })}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>
              ) : null}
            </ScrollView>

            <PrimaryButton
              label={addressResolutions && addressResolutions.length > 1 ? "Siradaki firmayi kaydet" : "Firma kaydini olustur"}
              onPress={() => void submitAddressResolution()}
              loading={resolutionSubmitting}
            />
            <GhostButton
              label="Vazgec"
              onPress={() => {
                setAddressResolutions(null);
                setDraftCompanies([]);
                setResolvedDrafts([]);
              }}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function CandidateCard({
  candidate,
  recommended = false,
  disabled,
  onPress
}: {
  candidate: NonNullable<AiCaptureResponse["companyResolution"]>["candidates"][number];
  recommended?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const distanceLabel = formatDistanceLabel(candidate.distanceMeters);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.candidateCard, pressed ? styles.candidateCardPressed : null]} disabled={disabled}>
      <View style={styles.candidateTop}>
        <Text style={styles.candidateName}>{candidate.name}</Text>
        <View style={styles.candidateBadges}>
          {recommended ? <Chip label="Onerilen sube" tone="success" /> : null}
          {distanceLabel ? <Chip label={distanceLabel} tone="warning" /> : null}
          <Chip label={`${candidate.taskCount} gorev`} tone={candidate.taskCount > 0 ? "warning" : "default"} />
        </View>
      </View>
      <Text style={styles.candidateMeta}>{candidate.address || "Adres bilgisi yok"}</Text>
    </Pressable>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function getCaptureTaskCompanyLabel(
  task: AiCaptureResponse["analysis"]["tasks"][number],
  analysis: AiCaptureResponse["analysis"]
) {
  // AI net şekilde bir kişi adı yakaladıysa firma etiketi yerine kişiyi göster.
  const personName = task.contactPersonName?.trim();
  if (personName && (task.personConfidence ?? 0) > 0.75) {
    return personName;
  }

  const taskCompanyName = task.companyName?.trim();
  if (taskCompanyName) {
    return taskCompanyName;
  }

  if (analysis.tasks.length === 1) {
    return analysis.company.name?.trim() || null;
  }

  return null;
}

function getCaptureAnalysisCompanyLabel(analysis: AiCaptureResponse["analysis"]) {
  const uniqueTaskCompanies = [
    ...new Set(
      analysis.tasks
        .map((task) => task.companyName?.trim())
        .filter((companyName): companyName is string => Boolean(companyName))
    ),
  ];

  if (uniqueTaskCompanies.length > 0) {
    return uniqueTaskCompanies.join(" · ");
  }

  return analysis.company.name?.trim() || "Firma bulunamadi";
}

const styles = StyleSheet.create({
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  micButton: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  micButtonActive: {
    backgroundColor: colors.primaryDark
  },
  heroCopy: {
    flex: 1,
    gap: 3
  },
  heroTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600"
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
  sectionHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17
  },
  transcriptField: {
    minHeight: 180,
    textAlignVertical: "top"
  },
  addressField: {
    minHeight: 100,
    textAlignVertical: "top"
  },
  addressCard: {
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    padding: 12
  },
  addressCardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600"
  },
  addressCardText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "500"
  },
  actions: {
    gap: 8
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  summaryCopy: {
    flex: 1
  },
  resolutionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  resolutionBannerText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "500",
    flex: 1
  },
  summaryStrip: {
    gap: 8
  },
  infoBlock: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  infoValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500"
  },
  previewList: {
    gap: 10
  },
  previewTask: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 8
  },
  previewTaskTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  previewTaskTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    flex: 1
  },
  previewTaskDesc: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  previewChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  createdBox: {
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(184,52,74,0.24)",
    padding: 12,
    gap: 8
  },
  createdTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600"
  },
  createdText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)"
  },
  modalCard: {
    maxHeight: "82%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.surfaceStrong,
    padding: 18,
    gap: 12
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10
  },
  modalIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center"
  },
  modalCopy: {
    flex: 1,
    gap: 3
  },
  modalTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600"
  },
  modalText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  modalList: {
    maxHeight: 280
  },
  modalListContent: {
    gap: 8
  },
  candidateSection: {
    gap: 8
  },
  candidateSectionTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  candidateCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    padding: 12,
    gap: 6
  },
  candidateCardPressed: {
    opacity: 0.7
  },
  candidateTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  candidateBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 6,
    flex: 1
  },
  candidateName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    flex: 1
  },
  candidateMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  }
});
