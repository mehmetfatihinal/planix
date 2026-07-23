import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AppHeader } from "@/components/app-header";
import { Card, Chip, EmptyState, Screen, StatTile, colors } from "@/components/ui";
import { getWeeklyAnalysis } from "@/lib/api";
import { useAppData } from "@/lib/app-data-context";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, formatPercent, getEffectiveTaskStatus, sortByDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { WeeklyAnalysisReport } from "@/types/business";

export default function WeeklyAnalysisScreen() {
  const { data } = useAppData();
  const { token } = useAuth();
  const { language } = useI18n();
  // Server-side weekly report (routes, visits, overdue reasons). Best-effort: the local
  // snapshot analysis below always renders, the server card appears when the API answers.
  const [report, setReport] = useState<WeeklyAnalysisReport | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getWeeklyAnalysis(token)
      .then((result) => { if (!cancelled) setReport(result); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [token]);

  const topCompanies = (report?.visitsByCompany ?? [])
    .map((row) => ({
      name: row.companyName ?? row.company ?? "Bilinmeyen firma",
      visits: row.visits ?? row.count ?? 0
    }))
    .sort((left, right) => right.visits - left.visits)
    .slice(0, 5);

  const completed = data.tasks.filter((task) => getEffectiveTaskStatus(task) === "done");
  const overdue = data.tasks.filter((task) => getEffectiveTaskStatus(task) === "overdue");
  const acceptedOffers = data.offers.filter((offer) => offer.status === "accepted");
  const waitingInvoices = data.invoices.filter((invoice) => invoice.status !== "paid");
  const totalPipeline = data.offers
    .filter((offer) => ["draft", "prepared", "sent", "followUpNeeded", "accepted"].includes(offer.status))
    .reduce((sum, offer) => sum + offer.total, 0);
  const weeklyFocus = sortByDateTime(data.tasks.filter((task) => getEffectiveTaskStatus(task) !== "done")).slice(0, 5);
  const followUps = data.companies.filter((company) => ["followUp", "waitingPayment", "offerSent"].includes(company.status)).slice(0, 4);
  const completionRate = data.tasks.length ? completed.length / data.tasks.length : 0;

  return (
    <Screen withTabs>
      <AppHeader title="Haftalik analiz" subtitle="Operasyon ritmi, teklif donusumu ve tahsilat baskisini mobilde hizli okuyun." />

      <View style={styles.statsGrid}>
        <StatTile label="Tamamlanan" value={completed.length} accent={colors.success} />
        <StatTile label="Tamamlanma orani" value={formatPercent(completionRate, language)} accent={colors.primary} />
        <StatTile label="Geciken" value={overdue.length} accent={colors.danger} />
        <StatTile label="Bekleyen odeme" value={waitingInvoices.length} accent={colors.warning} />
      </View>

      {report ? (
        <Card>
          <Text style={styles.sectionTitle}>Sunucu haftalık özeti</Text>
          <Text style={styles.sectionHint}>Rotalar, ziyaretler ve geciken görevler — sunucu raporundan</Text>
          <View style={styles.statsGrid}>
            <StatTile label="Rota" value={report.routes?.length ?? 0} accent={colors.primary} />
            <StatTile
              label="Ziyaret"
              value={Number(report.totals?.totalVisits ?? 0) || topCompanies.reduce((sum, row) => sum + row.visits, 0)}
              accent={colors.success}
            />
            <StatTile label="Geciken" value={report.overdueTasks?.length ?? 0} accent={colors.danger} />
          </View>
          {topCompanies.length ? (
            <View style={styles.reportBlock}>
              <Text style={styles.reportBlockTitle}>En çok ziyaret edilen firmalar</Text>
              {topCompanies.map((row) => (
                <View key={row.name} style={styles.reportRow}>
                  <Text style={styles.reportRowTitle}>{row.name}</Text>
                  <Chip label={`${row.visits} ziyaret`} />
                </View>
              ))}
            </View>
          ) : null}
          {report.overdueTasks?.length ? (
            <View style={styles.reportBlock}>
              <Text style={styles.reportBlockTitle}>Geciken görevler</Text>
              {report.overdueTasks.slice(0, 6).map((task) => (
                <View key={task.id} style={styles.reportRow}>
                  <View style={styles.reportRowCopy}>
                    <Text style={styles.reportRowTitle}>{task.title}</Text>
                    <Text style={styles.reportRowMeta}>
                      {[task.company, [task.dueDate, task.dueTime].filter(Boolean).join(" "), `${task.delayHours} sa gecikme`]
                        .filter(Boolean)
                        .join(" · ")}
                      {task.delayReason ? ` · Sebep: ${task.delayReason}` : ""}
                      {task.recurring ? " · tekrarlayan" : ""}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card variant="hero" style={styles.heroCard}>
        <Text style={styles.heroKicker}>Revenue pulse</Text>
        <Text style={styles.heroValue}>{formatCurrency(totalPipeline, language)}</Text>
        <Text style={styles.heroText}>
          {acceptedOffers.length} kabul edilen teklif, {waitingInvoices.length} tahsilat bekleyen fatura ve {followUps.length} aktif takip firmasi var.
        </Text>
      </Card>

      <Card>
        <View style={styles.sectionHead}>
          <View>
            <Text style={styles.sectionTitle}>Haftanin odaklari</Text>
            <Text style={styles.sectionHint}>Tamamlanmayan ama momentum isteyen en kritik kayitlar</Text>
          </View>
          <Chip label={`${weeklyFocus.length} kayit`} tone={weeklyFocus.length ? "warning" : "default"} />
        </View>
        {weeklyFocus.length === 0 ? (
          <EmptyState title="Aksiyon yok" description="Acik gorevler geldiginde bu alan haftalik odak listesini dolduracak." />
        ) : (
          weeklyFocus.map((task) => (
            <View key={task.id} style={styles.focusRow}>
              <View style={styles.focusIcon}>
                <Feather
                  name={getEffectiveTaskStatus(task) === "overdue" ? "alert-triangle" : "check-square"}
                  size={16}
                  color={getEffectiveTaskStatus(task) === "overdue" ? colors.danger : colors.primary}
                />
              </View>
              <View style={styles.focusCopy}>
                <Text style={styles.focusTitle}>{task.title}</Text>
                <Text style={styles.focusMeta}>{[task.dueDate, task.dueTime].filter(Boolean).join(" ") || "Plansiz"} · {task.priority}</Text>
              </View>
              <Chip label={task.type} />
            </View>
          ))
        )}
      </Card>

      <Card>
        <View style={styles.sectionHead}>
          <View>
            <Text style={styles.sectionTitle}>Takip gerektiren firmalar</Text>
            <Text style={styles.sectionHint}>Tahsilat, teklif ve follow-up baskisinin en yuksek oldugu hesaplar</Text>
          </View>
        </View>
        {followUps.length === 0 ? (
          <EmptyState title="Takip baskisi yok" description="Status degistiginde burada riskli hesaplar gorunur." />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.companyRail}>
            {followUps.map((company) => (
              <View key={company.id} style={styles.companyCardWrap}>
                <View style={styles.companyCard}>
                  <Text style={styles.companyName}>{company.name}</Text>
                  <Text style={styles.companyMeta}>{company.contactPerson || "Kontak yok"}</Text>
                  <Text style={styles.companyMeta}>{company.address || "Adres bilgisi yok"}</Text>
                  <View style={styles.companyStatusRow}>
                    <Chip label={company.status} tone="warning" />
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12
  },
  heroCard: {
    borderColor: colors.border
  },
  heroKicker: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  heroValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: -0.5
  },
  heroText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800"
  },
  sectionHint: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 3
  },
  reportBlock: {
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  reportBlockTitle: {
    color: colors.textSoft,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4
  },
  reportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 4
  },
  reportRowCopy: {
    flex: 1,
    gap: 2
  },
  reportRowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600"
  },
  reportRowMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  focusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12
  },
  focusIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center"
  },
  focusCopy: {
    flex: 1,
    gap: 4
  },
  focusTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700"
  },
  focusMeta: {
    color: colors.muted,
    fontSize: 13
  },
  companyRail: {
    gap: 12,
    paddingRight: 6
  },
  companyCardWrap: {
    width: 284
  },
  companyCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 16,
    gap: 8
  },
  companyName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800"
  },
  companyMeta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  companyStatusRow: {
    paddingTop: 4
  }
});
