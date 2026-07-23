import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { AppHeader } from "@/components/app-header";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Card, Chip, GhostButton, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { useAppData } from "@/lib/app-data-context";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { getCurrentUserLocation, hasUsableCoordinates } from "@/lib/location";
import { useUserLocation } from "@/lib/location-context";
import { ensureMobilePushRegistration, getNotificationPermission, loadMobileNotificationStatus } from "@/lib/notifications";

const REMINDER_LEAD_OPTIONS = [15, 30, 60, 120];

export default function SettingsScreen() {
  const { logout, token, user } = useAuth();
  const { settings, updateSettings } = useAppData();
  const { t } = useI18n();
  const { state: locationState, requestPermission } = useUserLocation();
  const [permission, setPermission] = useState<string>("unknown");
  const [subscriptionState, setSubscriptionState] = useState<{ subscribed: boolean; deviceCount: number }>({
    subscribed: false,
    deviceCount: 0
  });
  const [lastPushToken, setLastPushToken] = useState<string | null>(null);

  // Local drafts for the settings-backed fields; hydrated whenever fresh settings arrive.
  const [leadMinutesDraft, setLeadMinutesDraft] = useState("");
  const [savingLead, setSavingLead] = useState(false);
  const [savingHome, setSavingHome] = useState(false);
  const [savingDigest, setSavingDigest] = useState(false);
  const [companyDraft, setCompanyDraft] = useState({
    companyName: "",
    companyAddress: "",
    companyPhone: "",
    companyEmail: "",
    companyTaxId: "",
    companyIban: "",
    paymentTerms: ""
  });
  const [savingCompany, setSavingCompany] = useState(false);

  useEffect(() => {
    getNotificationPermission().then((result) => setPermission(result.status));
    if (token) {
      loadMobileNotificationStatus(token).then(setSubscriptionState).catch(() => undefined);
    }
  }, [token]);

  useEffect(() => {
    if (!settings) return;
    setLeadMinutesDraft(String(settings.defaultReminderLeadMinutes ?? 30));
    setCompanyDraft({
      companyName: settings.companyName ?? "",
      companyAddress: settings.companyAddress ?? "",
      companyPhone: settings.companyPhone ?? "",
      companyEmail: settings.companyEmail ?? "",
      companyTaxId: settings.companyTaxId ?? "",
      companyIban: settings.companyIban ?? "",
      paymentTerms: settings.paymentTerms ?? ""
    });
  }, [settings]);

  const homeSaved = Boolean(
    settings && hasUsableCoordinates({ latitude: settings.homeLatitude, longitude: settings.homeLongitude })
  );

  async function saveLeadMinutes(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      Alert.alert("Geçersiz değer", "Dakika değeri 0'dan büyük bir sayı olmalı.");
      return;
    }
    setSavingLead(true);
    try {
      await updateSettings({ defaultReminderLeadMinutes: Math.round(minutes) });
      setLeadMinutesDraft(String(Math.round(minutes)));
    } catch (error) {
      Alert.alert("Kaydedilemedi", error instanceof Error ? error.message : "Bildirim süresi güncellenemedi.");
    } finally {
      setSavingLead(false);
    }
  }

  async function saveHomeLocation() {
    setSavingHome(true);
    try {
      if (!locationState.granted) {
        await requestPermission();
      }
      const coords = await getCurrentUserLocation();
      await updateSettings({ homeLatitude: coords.latitude, homeLongitude: coords.longitude });
      Alert.alert("Ev konumu kaydedildi", "Evden çıktığınızda günün rotası otomatik hazırlanacak.");
    } catch (error) {
      Alert.alert("Konum alınamadı", error instanceof Error ? error.message : "Ev konumu kaydedilemedi.");
    } finally {
      setSavingHome(false);
    }
  }

  async function toggleDigest(key: "dailyDigestEnabled" | "weeklyDigestEnabled", value: boolean) {
    setSavingDigest(true);
    try {
      await updateSettings({ [key]: value });
    } catch (error) {
      Alert.alert("Kaydedilemedi", error instanceof Error ? error.message : "Özet ayarı güncellenemedi.");
    } finally {
      setSavingDigest(false);
    }
  }

  async function saveCompanyProfile() {
    setSavingCompany(true);
    try {
      await updateSettings({
        companyName: companyDraft.companyName.trim() || null,
        companyAddress: companyDraft.companyAddress.trim() || null,
        companyPhone: companyDraft.companyPhone.trim() || null,
        companyEmail: companyDraft.companyEmail.trim() || null,
        companyTaxId: companyDraft.companyTaxId.trim() || null,
        companyIban: companyDraft.companyIban.trim() || null,
        paymentTerms: companyDraft.paymentTerms.trim() || null
      });
      Alert.alert("Kaydedildi", "Firma profili güncellendi. PDF'lerde bu bilgiler kullanılacak.");
    } catch (error) {
      Alert.alert("Kaydedilemedi", error instanceof Error ? error.message : "Firma profili güncellenemedi.");
    } finally {
      setSavingCompany(false);
    }
  }

  return (
    <Screen withTabs>
      <AppHeader title={t("settings.title")} subtitle="Dil, bildirim ve oturum ayarlarını daha kontrollü bir panelden yönetin." />

      <Card variant="hero" style={styles.profileCard}>
        <Text style={styles.profileEyebrow}>Workspace profile</Text>
        <Text style={styles.profileName}>{user?.name ?? "Mobil operatör"}</Text>
        <Text style={styles.profileEmail}>{user?.email ?? "Bağlı hesap bilgisi yok"}</Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>{t("settings.language")}</Text>
        <Text style={styles.sectionHint}>Panelde kullanılan dil akışını burada değiştirin.</Text>
        <LanguageSwitcher />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Bildirim süresi</Text>
        <Text style={styles.sectionHint}>Randevudan kaç dakika önce hatırlatma alacağınızı belirleyin.</Text>
        <View style={styles.chipRow}>
          {REMINDER_LEAD_OPTIONS.map((minutes) => {
            const active = settings?.defaultReminderLeadMinutes === minutes;
            return (
              <Pressable
                key={minutes}
                onPress={() => void saveLeadMinutes(minutes)}
                style={[styles.leadChip, active && styles.leadChipActive]}
                disabled={savingLead}
              >
                <Text style={[styles.leadChipText, active && styles.leadChipTextActive]}>{minutes} dk</Text>
              </Pressable>
            );
          })}
        </View>
        <TextField
          label="Özel süre (dakika)"
          value={leadMinutesDraft}
          onChangeText={setLeadMinutesDraft}
          keyboardType="numeric"
          placeholder="30"
        />
        <PrimaryButton
          label={savingLead ? "Kaydediliyor..." : "Süreyi kaydet"}
          loading={savingLead}
          onPress={() => void saveLeadMinutes(Number(leadMinutesDraft))}
        />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Ev konumu</Text>
        <Text style={styles.sectionHint}>
          Ev konumu kayıtlıyken evden çıktığınız anda günün görevlerinden otomatik rota hazırlanır ve bildirimle gelir.
        </Text>
        <View style={styles.chipRow}>
          <Chip
            label={homeSaved ? "Ev konumu kayıtlı" : "Ev konumu kayıtlı değil"}
            tone={homeSaved ? "success" : "warning"}
          />
        </View>
        <PrimaryButton
          label={savingHome ? "Konum alınıyor..." : "Şu anki konumumu ev yap"}
          loading={savingHome}
          onPress={() => void saveHomeLocation()}
        />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Özet bildirimleri</Text>
        <Text style={styles.sectionHint}>Günlük ve haftalık operasyon özetlerini aç/kapat.</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Günlük özet</Text>
          <Switch
            value={Boolean(settings?.dailyDigestEnabled)}
            onValueChange={(value) => void toggleDigest("dailyDigestEnabled", value)}
            disabled={savingDigest || !settings}
            trackColor={{ true: colors.primary, false: colors.borderStrong }}
            thumbColor="#fff"
          />
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Haftalık özet</Text>
          <Switch
            value={Boolean(settings?.weeklyDigestEnabled)}
            onValueChange={(value) => void toggleDigest("weeklyDigestEnabled", value)}
            disabled={savingDigest || !settings}
            trackColor={{ true: colors.primary, false: colors.borderStrong }}
            thumbColor="#fff"
          />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Firma profili (PDF)</Text>
        <Text style={styles.sectionHint}>Teklif ve fatura PDF'lerinde kullanılan firma bilgileri.</Text>
        <TextField label="Firma adı" value={companyDraft.companyName} onChangeText={(value) => setCompanyDraft((c) => ({ ...c, companyName: value }))} placeholder="Örnek: Mega Ajans GmbH" />
        <TextField label="Adres" value={companyDraft.companyAddress} onChangeText={(value) => setCompanyDraft((c) => ({ ...c, companyAddress: value }))} placeholder="Cadde, No, Şehir" />
        <TextField label="Telefon" value={companyDraft.companyPhone} onChangeText={(value) => setCompanyDraft((c) => ({ ...c, companyPhone: value }))} keyboardType="phone-pad" placeholder="+49 ..." />
        <TextField label="E-posta" value={companyDraft.companyEmail} onChangeText={(value) => setCompanyDraft((c) => ({ ...c, companyEmail: value }))} keyboardType="email-address" autoCapitalize="none" placeholder="info@firma.de" />
        <TextField label="Vergi no" value={companyDraft.companyTaxId} onChangeText={(value) => setCompanyDraft((c) => ({ ...c, companyTaxId: value }))} placeholder="DE123456789" />
        <TextField label="IBAN" value={companyDraft.companyIban} onChangeText={(value) => setCompanyDraft((c) => ({ ...c, companyIban: value }))} autoCapitalize="characters" placeholder="DE00 0000 0000 0000 0000 00" />
        <TextField label="Ödeme koşulları" value={companyDraft.paymentTerms} onChangeText={(value) => setCompanyDraft((c) => ({ ...c, paymentTerms: value }))} placeholder="Örnek: 14 gün içinde ödeme" />
        <PrimaryButton
          label={savingCompany ? "Kaydediliyor..." : "Firma profilini kaydet"}
          loading={savingCompany}
          onPress={() => void saveCompanyProfile()}
        />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Android bildirimleri</Text>
        <Text style={styles.sectionHint}>Expo push kaydı, izin durumu ve cihaz bağlantısını izleyin.</Text>
        <View style={styles.chipRow}>
          <Chip label={`Izin: ${permission}`} />
          <Chip
            label={subscriptionState.subscribed ? t("notifications.connected") : "Bağlı cihaz yok"}
            tone={subscriptionState.subscribed ? "success" : "warning"}
          />
        </View>
        <View style={styles.metricRow}>
          <Metric label="Kayıtlı cihaz" value={String(subscriptionState.deviceCount)} />
          <Metric label="Son token" value={lastPushToken ? "Hazır" : "Yok"} />
        </View>
        <PrimaryButton
          label={t("notifications.enable")}
          onPress={async () => {
            if (!token) return;
            const result = await ensureMobilePushRegistration(token);
            if (result.subscribed) {
              setLastPushToken(result.token ?? null);
              setSubscriptionState(await loadMobileNotificationStatus(token));
              const next = await getNotificationPermission();
              setPermission(next.status);
            }
          }}
        />
        {lastPushToken ? <Text style={styles.tokenText}>{lastPushToken}</Text> : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Oturum</Text>
        <Text style={styles.sectionHint}>Bu cihazdaki aktif kullanıcı oturumunu sonlandırın.</Text>
        <GhostButton label={t("actions.logout")} onPress={() => void logout()} />
      </Card>
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    borderColor: "#3a2a25"
  },
  profileEyebrow: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  profileName: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "600",
    letterSpacing: -0.3
  },
  profileEmail: {
    color: colors.muted,
    fontSize: 13
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2
  },
  sectionHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  leadChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  leadChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  leadChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500"
  },
  leadChipTextActive: {
    color: colors.text
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 40
  },
  toggleLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500"
  },
  metricRow: {
    flexDirection: "row",
    gap: 10
  },
  metricCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 4
  },
  metricLabel: {
    color: colors.subtle,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.7
  },
  metricValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800"
  },
  tokenText: {
    color: colors.subtle,
    fontSize: 11
  }
});
