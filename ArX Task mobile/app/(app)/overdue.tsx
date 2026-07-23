import { StyleSheet, Text, View } from "react-native";
import { AppHeader } from "@/components/app-header";
import { EmptyState, Screen, colors } from "@/components/ui";
import { InvoiceSummaryCard } from "@/components/operations-cards";
import { TaskCard } from "@/components/task-card";
import { useAppData } from "@/lib/app-data-context";
import { companyById, getEffectiveTaskStatus } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { canRouteToCompany, openCompanyRoute } from "@/lib/location";
import { useUserLocation } from "@/lib/location-context";

export default function OverdueScreen() {
  const { data, markTaskDone, snoozeTask, updateTask, cancelTask, addTaskNote } = useAppData();
  const { language } = useI18n();
  const { state: locationState } = useUserLocation();

  const overdueTasks = data.tasks.filter((task) => getEffectiveTaskStatus(task) === "overdue");
  const overdueInvoices = data.invoices.filter((invoice) => invoice.status === "overdue");

  return (
    <Screen withTabs>
      <AppHeader title="Gecikenler" subtitle="Sahada kaçırılan işleri ve tahsilat riskini bu yüzeyden kapatın." />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Geciken gorevler</Text>
        <Text style={styles.sectionHint}>Snooze, tamamla veya iptal et aksiyonlari dogrudan burada.</Text>
        {overdueTasks.length === 0 ? (
          <EmptyState title="Geciken gorev yok" description="Tum acik isler zamaninda gorunuyor." />
        ) : (
          overdueTasks.map((task) => {
            const company = task.companyId ? companyById(data.companies, task.companyId) : undefined;
            return (
              <TaskCard
                key={task.id}
                task={task}
                company={company}
                onDone={(note) => markTaskDone(task, note)}
                onReschedule={(date, time) => updateTask({ ...task, dueDate: date, dueTime: time, status: "open", notificationsEnabled: true })}
                onSnooze={(hours) => snoozeTask(task, hours)}
                onCancel={() => cancelTask(task.id)}
                onAddNote={(content) => addTaskNote(task, content)}
                onOpenRoute={company && canRouteToCompany(company) ? () => openCompanyRoute(company, locationState.coords) : undefined}
              />
            );
          })
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Geciken faturalar</Text>
        <Text style={styles.sectionHint}>Tahsilat baskisi yuksek olan faturalari once burada gorun.</Text>
        {overdueInvoices.length === 0 ? (
          <EmptyState title="Geciken fatura yok" description="Butun fatura kayitlari guncel durumda." />
        ) : (
          overdueInvoices.map((invoice) => (
            <InvoiceSummaryCard key={invoice.id} invoice={invoice} company={companyById(data.companies, invoice.companyId)} language={language} />
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
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
    lineHeight: 17
  }
});
