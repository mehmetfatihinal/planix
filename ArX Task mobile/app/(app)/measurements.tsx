import { StyleSheet, Text, View } from "react-native";
import { AppHeader } from "@/components/app-header";
import { DocumentSummaryCard } from "@/components/operations-cards";
import { EmptyState, Screen, StatTile, colors } from "@/components/ui";
import { TaskCard } from "@/components/task-card";
import { useAppData } from "@/lib/app-data-context";
import { companyById, isMeasurementDocument } from "@/lib/format";

export default function MeasurementsScreen() {
  const { data, markTaskDone, snoozeTask, updateTask, cancelTask, addTaskNote } = useAppData();

  const measurementTasks = data.tasks.filter((task) => task.type === "measurements" || task.moduleIds.includes("module-measurements"));
  const measurementDocs = data.documents.filter(isMeasurementDocument);
  const companiesCovered = new Set(measurementTasks.map((task) => task.companyId).filter(Boolean)).size;

  return (
    <Screen withTabs>
      <AppHeader title="Olcum merkezi" subtitle="Saha olcum isleri, bagli belgeler ve eksik kayitlar tek mobil akis olarak sunulur." />

      <View style={styles.statsGrid}>
        <StatTile label="Olcum gorevi" value={measurementTasks.length} accent={colors.primary} />
        <StatTile label="Ilgili belge" value={measurementDocs.length} accent={colors.warning} />
        <StatTile label="Firma" value={companiesCovered} accent={colors.text} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Acik olcum gorevleri</Text>
        <Text style={styles.sectionHint}>Sahadaki kesif, olcu alma ve teslim oncesi dogrulama akisi</Text>
        {measurementTasks.length === 0 ? (
          <EmptyState title="Olcum gorevi yok" description="Olcum tipindeki yeni saha isleri burada listelenecek." />
        ) : (
          measurementTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              company={task.companyId ? companyById(data.companies, task.companyId) : undefined}
              onDone={(note) => markTaskDone(task, note)}
                onReschedule={(date, time) => updateTask({ ...task, dueDate: date, dueTime: time, status: "open", notificationsEnabled: true })}
              onSnooze={(hours) => snoozeTask(task, hours)}
              onCancel={() => cancelTask(task.id)}
              onAddNote={(content) => addTaskNote(task, content)}
            />
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Olcum belgeleri</Text>
        <Text style={styles.sectionHint}>Kesif raporu, foto ve teknik notlarin hizli ozeti</Text>
        {measurementDocs.length === 0 ? (
          <EmptyState title="Belge yok" description="Olcumle ilgili belge eklendiginde burada gorunur." />
        ) : (
          measurementDocs.map((document) => (
            <DocumentSummaryCard key={document.id} document={document} companies={data.companies} />
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12
  },
  section: {
    gap: 12
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800"
  },
  sectionHint: {
    color: colors.muted,
    fontSize: 13
  }
});
