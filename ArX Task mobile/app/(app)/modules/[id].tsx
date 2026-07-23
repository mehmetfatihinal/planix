import { useState } from "react";
import { Text, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppHeader } from "@/components/app-header";
import { SheetModal } from "@/components/sheet-modal";
import { EmptyState, GhostButton, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { TaskCard } from "@/components/task-card";
import { useAppData } from "@/lib/app-data-context";
import { companyById, moduleNameById, tasksForModule } from "@/lib/format";

export default function ModuleDetailScreen() {
  const router = useRouter();
  const { data, addTaskNote, cancelTask, createTask, deleteModule, markTaskDone, snoozeTask, updateTask, updateModule } = useAppData();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [composerOpen, setComposerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const module = data.modules.find((item) => item.id === id || encodeURIComponent(item.id) === id);
  const moduleName = moduleNameById(data.modules, id);
  const tasks = tasksForModule(data.tasks, id);

  if (!module) {
    return (
      <Screen withTabs>
        <EmptyState title="Bu modul bulunamadi" description="Liste yenilenirken ekran acilmis olabilir." />
      </Screen>
    );
  }

  return (
    <Screen withTabs>
      <AppHeader title={moduleName} subtitle="Bu modüle bagli tum acik ve planli kayitlar." />
      <View style={styles.actions}>
        <PrimaryButton label="Gorev ekle" onPress={() => setComposerOpen(true)} />
        <GhostButton
          label={module.isPinnedToSidebar ? "Sabitlemeyi kaldir" : "Sabitle"}
          onPress={() => void updateModule({ ...module, isPinnedToSidebar: !module.isPinnedToSidebar })}
        />
        <PrimaryButton label="Modulu sil" variant="danger" onPress={() => setDeleteOpen(true)} />
      </View>
      <Text style={styles.helper}>Tip: {module.type} · Kaynak: {module.createdByAI ? "AI" : "Manual"} · Acik is: {module.taskCount}</Text>
      {tasks.length === 0 ? (
        <EmptyState title="Bu grupta gorev yok" description="Yeni gorev AI capture veya manuel akis ile olusabilir." />
      ) : (
        tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={{ ...task, moduleIds: task.moduleIds.map((moduleId) => moduleNameById(data.modules, moduleId)) }}
            company={companyById(data.companies, task.companyId)}
            onDone={(note) => markTaskDone(task, note)}
                onReschedule={(date, time) => updateTask({ ...task, dueDate: date, dueTime: time, status: "open", notificationsEnabled: true })}
            onSnooze={(hours) => snoozeTask(task, hours)}
            onAddNote={(content) => addTaskNote(task, content)}
            onCancel={() => cancelTask(task.id)}
          />
        ))
      )}

      <SheetModal
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Modul gorevi"
        subtitle="Secili modül icin yeni bir is kaydi olusturun."
        footer={
          <>
            <PrimaryButton
              label="Kaydet"
              onPress={async () => {
                await createTask({
                  title: taskTitle,
                  description: `${module.name} modulu icin mobilden olusturuldu`,
                  type: module.type,
                  moduleIds: [module.id]
                });
                setTaskTitle("");
                setComposerOpen(false);
              }}
            />
            <GhostButton label="Vazgec" onPress={() => setComposerOpen(false)} />
          </>
        }
      >
        <TextField label="Gorev basligi" value={taskTitle} onChangeText={setTaskTitle} placeholder="Ornek: Musteri ziyareti planla" />
      </SheetModal>

      <SheetModal
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Modulu sil"
        subtitle="Bu modul ve modulle bagli gorev referanslari kaldirilacak. Islem geri alinmaz."
        footer={
          <>
            <PrimaryButton
              label="Sil"
              variant="danger"
              onPress={async () => {
                await deleteModule(module.id);
                setDeleteOpen(false);
                router.back();
              }}
            />
            <GhostButton label="Vazgec" onPress={() => setDeleteOpen(false)} />
          </>
        }
      >
        <Text style={styles.deleteCopy}>"{module.name}" modulunu silmek istediginizden emin misiniz?</Text>
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 10
  },
  helper: {
    color: colors.subtle,
    fontSize: 12
  },
  deleteCopy: {
    color: colors.textSoft,
    lineHeight: 22
  }
});
