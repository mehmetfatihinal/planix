import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { AppHeader } from "@/components/app-header";
import { Card, Chip, EmptyState, GhostButton, PrimaryButton, Screen, StatTile, colors } from "@/components/ui";
import { DocumentSummaryCard, InvoiceSummaryCard, OfferSummaryCard } from "@/components/operations-cards";
import { useAppData } from "@/lib/app-data-context";
import { companyById, formatCurrency, getEffectiveTaskStatus, isTaskOpen, moduleNameById, sortByDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { openMultiCompanyRoute } from "@/lib/location";
import { buildTodayRoutePlan, describeRouteExclusion } from "@/lib/today-route";
import { useUserLocation } from "@/lib/location-context";

export default function DashboardScreen() {
  const router = useRouter();
  const { data, refresh, refreshing } = useAppData();
  const { language, t } = useI18n();
  const { state: locationState, refreshLocation, requestPermission } = useUserLocation();

  // Alışkanlıklar (isHabit) normal görev sayımlarına dahil edilmez — onlar Alışkanlıklar ekranında.
  const openTasks = data.tasks.filter((task) => isTaskOpen(task) && !task.isHabit);
  const pendingOffers = data.offers.filter((offer) => ["prepared", "sent", "followUpNeeded", "draft"].includes(offer.status));
  const waitingInvoices = data.invoices.filter((invoice) => ["unpaid", "overdue", "partiallyPaid"].includes(invoice.status));
  const routeCandidates = openTasks.filter((task) => ["visits", "installation", "support", "measurements"].includes(task.type));
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayTasks = sortByDateTime(openTasks.filter((task) => task.dueDate === todayKey));
  const agenda = todayTasks.slice(0, 6);
  const activeModules = data.modules.filter((module) => module.taskCount > 0).slice(0, 5);
  const waitingTotal = waitingInvoices.reduce((sum, item) => sum + item.total, 0);
  const todayRoutePlan = buildTodayRoutePlan(todayTasks, data.companies, locationState.coords);
  const excludedNames = Array.from(new Set(todayRoutePlan.excludedTasks.map((item) => item.task.title))).slice(0, 3).join(", ");

  async function handleStartTodayRoute() {
    try {
      if (!todayRoutePlan.stops.length) {
        return;
      }

      let nextCoords = locationState.coords;
      if (!nextCoords && locationState.canAskAgain && locationState.status !== "denied") {
        await requestPermission();
        nextCoords = locationState.coords;
      }
      if (!nextCoords && locationState.granted) {
        await refreshLocation();
        nextCoords = locationState.coords;
      }

      await openMultiCompanyRoute(todayRoutePlan.stops.map((stop) => stop.company), nextCoords ?? null);

      if (todayRoutePlan.excludedTasks.length) {
        Alert.alert(
          "Rota uyarisi",
          `${todayRoutePlan.excludedTasks.length} gorev rotaya eklenmedi (${describeRouteExclusion(todayRoutePlan.excludedTasks[0]!.reason)}): ${excludedNames}`
        );
      }
    } catch (error) {
      Alert.alert("Rota acilamadi", error instanceof Error ? error.message : "Google Maps rotasi baslatilamadi.");
    }
  }

  return (
    <Screen withTabs onRefresh={refresh} refreshing={refreshing}>
      <AppHeader title={t("dashboard.title")} subtitle="Günlük operasyon ritmi, satış yüzeyi ve saha kayıtları." />

      <Card>
        <View style={styles.heroTop}>
          <Text style={styles.heroEyebrow}>Bugün</Text>
          <Text style={styles.heroTime}>
            {new Date().toLocaleTimeString(language === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
        <Text style={styles.heroTitle}>
          {openTasks.length > 0
            ? `${openTasks.length} açık iş, ${pendingOffers.length} teklif takibi`
            : "Bugün için yeni bir kayıt yok"}
        </Text>
        <Text style={styles.heroSubtitle}>
          {openTasks.length > 0
            ? "Operasyonu hızlandırmak için ses notu açın veya bugün listesine geçin."
            : "Ses notu ile yeni görev, teklif veya hatırlatma oluşturabilirsiniz."}
        </Text>
        <View style={styles.heroActions}>
          <View style={{ flex: 1 }}>
            <PrimaryButton label="Yeni ses notu" onPress={() => router.push("/capture" as never)} />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton label="Bugün listesi" variant="secondary" onPress={() => router.push("/today" as never)} />
          </View>
        </View>
      </Card>

      <View style={styles.statsGrid}>
        <StatTile label="Acik gorev" value={openTasks.length} accent={colors.text} />
        <StatTile label="Bekleyen teklif" value={pendingOffers.length} accent={colors.warning} />
        <StatTile label="Odeme takibi" value={waitingInvoices.length} accent={colors.danger} />
        <StatTile label="Rota adayi" value={routeCandidates.length} accent={colors.primary} />
      </View>

      <Text style={styles.groupEyebrow}>Operasyon</Text>
      <View style={styles.actionGrid}>
        <ActionPanel icon="calendar" title="Bugün" copy="Bugüne ait açık, planlı ve geciken işler." onPress={() => router.push("/today" as never)} />
        <ActionPanel icon="check-square" title="Görevler" copy="Tüm görevler — durum filtreleri." onPress={() => router.push("/tasks" as never)} />
        <ActionPanel icon="alert-triangle" title="Gecikenler" copy="Geciken görev ve faturalar." onPress={() => router.push("/overdue" as never)} />
        <ActionPanel icon="map" title="Rota Planlayıcı" copy="Çok duraklı rota optimizasyonu." onPress={() => router.push("/route-planner" as never)} />
        <ActionPanel icon="shopping-cart" title="Alışveriş Listesi" copy="Alınacaklar — satıcı yakınında hatırlatma." onPress={() => router.push("/shopping" as never)} />
        <ActionPanel icon="bar-chart-2" title="Haftalık Analiz" copy="Tamamlanma, pipeline, takip baskısı." onPress={() => router.push("/weekly-analysis" as never)} />
        <ActionPanel icon="message-circle" title="AI Asistan" copy="Snapshot içinden hızlı özet al." onPress={() => router.push("/ai-assistant" as never)} />
        <ActionPanel icon="repeat" title={t("habits.nav")} copy={t("habits.navCopy")} onPress={() => router.push("/habits" as never)} />
      </View>

      <Text style={styles.groupEyebrow}>Satış</Text>
      <View style={styles.actionGrid}>
        <ActionPanel icon="file-text" title="Teklif Oluştur" copy="Hızlı yeni teklif kaydı." onPress={() => router.push({ pathname: "/offers", params: { view: "create" } })} />
        <ActionPanel icon="credit-card" title="Fatura Oluştur" copy="Hızlı fatura ve tahsilat takibi." onPress={() => router.push({ pathname: "/invoices", params: { view: "create" } })} />
        <ActionPanel icon="clock" title="Bekleyen Teklifler" copy="Takip gereken teklif akışı." onPress={() => router.push({ pathname: "/offers", params: { view: "pending" } })} />
        <ActionPanel icon="dollar-sign" title="Bekleyen Ödemeler" copy="Açık ve geciken tahsilat." onPress={() => router.push({ pathname: "/invoices", params: { view: "waiting" } })} />
        <ActionPanel icon="box" title="Paketler" copy="Tekrar kullanılan fiyat paketleri." onPress={() => router.push({ pathname: "/offers", params: { view: "packages" } })} />
        <ActionPanel icon="package" title="Ürünler & Fiyatlar" copy="Fiyatlar, minimumlar, marjlar." onPress={() => router.push("/products" as never)} />
      </View>

      <Text style={styles.groupEyebrow}>Belgeler</Text>
      <View style={styles.actionGrid}>
        <ActionPanel icon="file" title="PDF'ler" copy="Tüm PDF belgeleri." onPress={() => router.push({ pathname: "/documents", params: { type: "pdf" } })} />
        <ActionPanel icon="image" title="Fotoğraflar" copy="Saha çekimleri ve görseller." onPress={() => router.push({ pathname: "/documents", params: { type: "photo" } })} />
        <ActionPanel icon="edit" title="Sözleşmeler" copy="İmzalı ve taslak sözleşmeler." onPress={() => router.push({ pathname: "/documents", params: { type: "contract" } })} />
        <ActionPanel icon="crosshair" title="Ölçümler" copy="Ölçüm raporları ve dosyaları." onPress={() => router.push("/measurements" as never)} />
        <ActionPanel icon="list" title="Fiyat Listeleri" copy="Resmi fiyat listesi belgeleri." onPress={() => router.push({ pathname: "/documents", params: { type: "priceList" } })} />
      </View>

      <Text style={styles.groupEyebrow}>Firmalar</Text>
      <View style={styles.actionGrid}>
        <ActionPanel icon="briefcase" title="Tüm Firmalar" copy="Arama ile firma kartlarını aç." onPress={() => router.push("/companies" as never)} />
      </View>

      <Text style={styles.groupEyebrow}>Arşiv</Text>
      <View style={styles.actionGrid}>
        <ActionPanel icon="check-circle" title="Tamamlananlar" copy="Bugün biten görevlerin listesi." onPress={() => router.push({ pathname: "/today", params: { view: "completed" } })} />
        <ActionPanel icon="x-circle" title="Kaybedilen Teklifler" copy="Reddedilmiş teklif akışı." onPress={() => router.push({ pathname: "/offers", params: { view: "lost" } })} />
        <ActionPanel icon="archive" title="Eski Firmalar" copy="Arşivlenmiş şirket kayıtları." onPress={() => router.push({ pathname: "/companies", params: { view: "archived" } })} />
      </View>

      <Card>
        <View style={styles.sectionHead}>
          <View>
            <Text style={styles.sectionTitle}>Bugunun oncelikleri</Text>
            <Text style={styles.sectionHint}>
              {todayRoutePlan.excludedTasks.length
                ? `${todayRoutePlan.excludedTasks.length} gorev rotaya eklenmedi. ${excludedNames}`
                : "Saat, baglam ve hareket gerektiren kayitlar"}
            </Text>
          </View>
          <Chip label={`${agenda.length} kayit`} tone={agenda.length ? "success" : "warning"} />
        </View>
        <View style={styles.todayActions}>
          <PrimaryButton label="Rotayi baslat" onPress={() => void handleStartTodayRoute()} />
          <GhostButton label={todayRoutePlan.stops.length ? `${todayRoutePlan.stops.length} durak` : "Rota adayi yok"} onPress={() => router.push("/route-planner" as never)} />
        </View>
        {agenda.length === 0 ? (
          <EmptyState title="Bugun icin gorev yok" description="Ilk gorev olustugunda bu alan otomatik dolacak." />
        ) : (
          agenda.map((task) => {
            const company = companyById(data.companies, task.companyId);
            const moduleName = task.moduleIds[0] ? moduleNameById(data.modules, task.moduleIds[0]) : "Genel";
            return (
              <Pressable key={task.id} onPress={() => router.push({ pathname: "/(app)/today", params: { task: task.id } })} style={styles.agendaRow}>
                <View style={styles.agendaLeft}>
                  <View style={styles.agendaMeta}>
                    <Text style={styles.agendaCompany}>{company?.name ?? "Kisisel"}</Text>
                    <Chip label={moduleName} />
                  </View>
                  <Text style={styles.agendaTitle}>{task.title}</Text>
                  <Text style={styles.agendaSubtle}>{[task.dueDate, task.dueTime].filter(Boolean).join(" ") || "Plansiz"}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.subtle} />
              </Pressable>
            );
          })
        )}
      </Card>

      <View style={styles.lowerGrid}>
        <Card style={styles.flexCard}>
          <View style={styles.sectionHead}>
            <View>
              <Text style={styles.sectionTitle}>Aktif moduller</Text>
              <Text style={styles.sectionHint}>Saha akisindaki calisan is alanlari</Text>
            </View>
          </View>
          {activeModules.length === 0 ? (
            <EmptyState title="Modul bulunamadi" description="Yeni analizler geldikce burada listelenir." />
          ) : (
            <View style={styles.moduleWrap}>
              {activeModules.map((module) => (
                <Pressable
                  key={module.id}
                  onPress={() => router.push({ pathname: "/(app)/modules/[id]", params: { id: module.id } })}
                  style={styles.modulePill}
                >
                  <Text style={styles.modulePillTitle}>{module.name}</Text>
                  <Text style={styles.modulePillCount}>{module.taskCount} acik is</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Card>

        <Card style={styles.cashCard}>
          <Text style={styles.cashLabel}>Bekleyen tahsilat</Text>
          <Text style={styles.cashValue}>{formatCurrency(waitingTotal, language)}</Text>
          <Text style={styles.cashHint}>Acik ve geciken fatura toplami</Text>
        </Card>
      </View>

      <View style={styles.recordsGrid}>
        <View style={styles.recordColumn}>
          <View style={styles.sectionHead}>
            <View>
              <Text style={styles.sectionTitle}>Teklif akisi</Text>
              <Text style={styles.sectionHint}>Hazir ve takip gereken tekliflerin ozeti</Text>
            </View>
            <GhostButton label="Hepsi" onPress={() => router.push("/offers" as never)} />
          </View>
          {pendingOffers.length === 0 ? (
            <EmptyState title="Teklif yok" description="Ilk teklif kaydini olusturdugunuzda burada gorunur." />
          ) : (
            pendingOffers.slice(0, 2).map((offer) => (
              <OfferSummaryCard key={offer.id} offer={offer} company={companyById(data.companies, offer.companyId)} language={language} />
            ))
          )}
        </View>

        <View style={styles.recordColumn}>
          <View style={styles.sectionHead}>
            <View>
              <Text style={styles.sectionTitle}>Fatura akisi</Text>
              <Text style={styles.sectionHint}>Tahsilat ve odeme takibi gereken kayitlar</Text>
            </View>
            <GhostButton label="Hepsi" onPress={() => router.push("/invoices" as never)} />
          </View>
          {waitingInvoices.length === 0 ? (
            <EmptyState title="Fatura yok" description="Bekleyen odemeler burada listelenecek." />
          ) : (
            waitingInvoices.slice(0, 2).map((invoice) => (
              <InvoiceSummaryCard key={invoice.id} invoice={invoice} company={companyById(data.companies, invoice.companyId)} language={language} />
            ))
          )}
        </View>
      </View>

      <Card>
        <View style={styles.sectionHead}>
          <View>
            <Text style={styles.sectionTitle}>Son dokumanlar</Text>
            <Text style={styles.sectionHint}>Firma bagli belge ozeti ve son yuklemeler</Text>
          </View>
          <GhostButton label="Tum belgeler" onPress={() => router.push("/documents" as never)} />
        </View>
        {data.documents.length === 0 ? (
          <EmptyState title="Dokuman yok" description="Ilk belge eklendiginde burada gozukur." />
        ) : (
          data.documents.slice(0, 2).map((document) => (
            <DocumentSummaryCard key={document.id} document={document} companies={data.companies} />
          ))
        )}
      </Card>
    </Screen>
  );
}

function ActionPanel({
  icon,
  title,
  copy,
  onPress
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  copy: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionPanel, pressed && { opacity: 0.7 }]}>
      <View style={styles.actionIcon}>
        <Feather name={icon} size={15} color={colors.textSoft} />
      </View>
      <View style={styles.actionCopyWrap}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionCopy} numberOfLines={2}>{copy}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.subtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  heroEyebrow: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  heroTime: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500"
  },
  heroTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "600",
    lineHeight: 25,
    letterSpacing: -0.3
  },
  heroSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  heroActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  actionGrid: {
    gap: 10
  },
  groupEyebrow: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 6,
    marginBottom: -6
  },
  managementGrid: {
    gap: 10
  },
  actionPanel: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
    flexDirection: "row",
    alignItems: "center"
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4
  },
  actionCopyWrap: {
    flex: 1,
    gap: 2
  },
  actionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600"
  },
  actionCopy: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12
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
  todayActions: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8
  },
  todayActionsItem: {
    flex: 1
  },
  agendaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  agendaLeft: {
    flex: 1,
    gap: 3
  },
  agendaMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap"
  },
  agendaCompany: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  agendaTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500"
  },
  agendaSubtle: {
    color: colors.muted,
    fontSize: 12
  },
  lowerGrid: {
    gap: 12
  },
  flexCard: {
    flex: 1
  },
  moduleWrap: {
    gap: 6
  },
  modulePill: {
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2
  },
  modulePillTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500"
  },
  modulePillCount: {
    color: colors.muted,
    fontSize: 11
  },
  cashCard: {
    backgroundColor: colors.surfaceStrong
  },
  cashLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  cashValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: -0.5
  },
  cashHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  recordsGrid: {
    gap: 12
  },
  recordColumn: {
    gap: 10
  }
});
