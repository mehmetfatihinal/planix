import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { AppHeader } from "@/components/app-header";
import { DocumentSummaryCard, FilterChips, InvoiceSummaryCard, OfferSummaryCard, TimelineCardList } from "@/components/operations-cards";
import { SheetModal } from "@/components/sheet-modal";
import { Card, Chip, EmptyState, GhostButton, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { TaskCard } from "@/components/task-card";
import { useAppData } from "@/lib/app-data-context";
import { formatDateLabel, isTaskOpen } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { canRouteToCompany, openCompanyRoute } from "@/lib/location";
import { useUserLocation } from "@/lib/location-context";

type CompanyTab = "overview" | "tasks" | "notes" | "offers" | "invoices" | "documents" | "timeline" | "next";

export default function CompanyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, addTaskNote, archiveCompany, cancelTask, createTask, deleteCompany, markTaskDone, snoozeTask, unarchiveCompany, updateTask, updateCompany } = useAppData();
  const { language } = useI18n();
  const { state: locationState } = useUserLocation();
  const [tab, setTab] = useState<CompanyTab>("overview");
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [companyEditorOpen, setCompanyEditorOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyContact, setCompanyContact] = useState("");
  const company = data.companies.find((item) => item.id === id);

  if (!company) {
    return (
      <Screen withTabs>
        <EmptyState title="Firma bulunamadi" description="Kayit yenilenirken bu ekran acilmis olabilir." />
      </Screen>
    );
  }

  const tasks = data.tasks.filter((task) => task.companyId === company.id);
  const notes = data.notes.filter((note) => note.companyId === company.id);
  const offers = data.offers.filter((offer) => offer.companyId === company.id);
  const invoices = data.invoices.filter((invoice) => invoice.companyId === company.id);
  const documents = data.documents.filter((document) => document.companyId === company.id);
  const timeline = data.timeline.filter((entry) => entry.companyId === company.id).slice(0, 10);
  const openCompanyEditor = () => {
    setCompanyName(company.name);
    setCompanyAddress(company.address);
    setCompanyPhone(company.phone);
    setCompanyEmail(company.email);
    setCompanyContact(company.contactPerson);
    setCompanyEditorOpen(true);
  };
  const confirmDelete = () => {
    Alert.alert("Firmayı sil", `${company.name} kaydını kaldırmak istiyor musun?`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: async () => {
          await deleteCompany(company.id);
          router.replace("/(app)/companies");
        }
      }
    ]);
  };
  const isArchived = Boolean(company.archivedAt);
  const handleArchiveToggle = async () => {
    if (isArchived) {
      await unarchiveCompany(company.id);
    } else {
      await archiveCompany(company.id);
      router.replace({ pathname: "/(app)/companies", params: { view: "archived" } });
    }
  };

  return (
    <Screen withTabs>
      <AppHeader title={company.name} subtitle={company.contactPerson || company.phone || company.email || "Firma detayi"} />

      <Card>
        <View style={styles.headerRow}>
          <Chip label={company.status} />
          <Pressable onPress={openCompanyEditor} hitSlop={8} style={({ pressed }) => [styles.editAddressRow, pressed && { opacity: 0.7 }]}>
            <Text style={styles.address}>{company.address || "Adres girilmedi"}</Text>
            <Feather name="edit-2" size={13} color={colors.muted} />
          </Pressable>
        </View>
        <Text style={styles.contact}>{company.phone || "Telefon yok"} · {company.email || "E-posta yok"}</Text>
        <View style={styles.headerActions}>
          <PrimaryButton label="Bilgileri düzenle" onPress={openCompanyEditor} />
          {canRouteToCompany(company) ? (
            <PrimaryButton label="Rotayı aç" variant="secondary" onPress={() => void openCompanyRoute(company, locationState.coords).catch(() => undefined)} />
          ) : null}
          <PrimaryButton
            label={isArchived ? "Arşivden çıkar" : "Firmayı arşivle"}
            variant="secondary"
            onPress={() => void handleArchiveToggle()}
          />
          <Pressable onPress={confirmDelete} style={({ pressed }) => [styles.deleteLink, pressed && { opacity: 0.6 }]}>
            <Feather name="trash-2" size={13} color={colors.danger} />
            <Text style={styles.deleteLinkText}>Firmayı sil</Text>
          </Pressable>
        </View>
      </Card>

      <FilterChips
        options={[
          { label: "Genel", value: "overview" },
          { label: "Gorevler", value: "tasks" },
          { label: "Notlar", value: "notes" },
          { label: "Teklifler", value: "offers" },
          { label: "Faturalar", value: "invoices" },
          { label: "Belgeler", value: "documents" },
          { label: "Timeline", value: "timeline" },
          { label: "Sonraki adim", value: "next" }
        ]}
        value={tab}
        onChange={(next) => setTab(next as CompanyTab)}
      />

      {tab === "overview" ? (
        <>
          <Card>
            <Text style={styles.blockTitle}>Genel bakis</Text>
            <View style={styles.metricGrid}>
              <Metric label="Acik gorev" value={String(tasks.filter((task) => isTaskOpen(task)).length)} />
              <Metric label="Teklif" value={String(offers.length)} />
              <Metric label="Fatura" value={String(invoices.length)} />
              <Metric label="Belge" value={String(documents.length)} />
            </View>
          </Card>
          <Card>
            <Text style={styles.blockTitle}>Baglanti bilgileri</Text>
            <Text style={styles.lineSubtitle}>Telefon: {company.phone || "-"}</Text>
            <Text style={styles.lineSubtitle}>E-posta: {company.email || "-"}</Text>
            <Text style={styles.lineSubtitle}>Kisi: {company.contactPerson || "-"}</Text>
          </Card>
        </>
      ) : null}

      {tab === "tasks" ? (
        <>
          <PrimaryButton label="Gorev olustur" onPress={() => setTaskComposerOpen(true)} />
          {tasks.length === 0 ? (
            <EmptyState title="Gorev yok" description="Bu firmaya bagli ilk gorev AI capture veya manuel akisla olusabilir." />
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={{ ...task, moduleIds: task.moduleIds.map((moduleId) => data.modules.find((item) => item.id === moduleId)?.name ?? moduleId) }}
                company={company}
                onDone={(note) => markTaskDone(task, note)}
                onReschedule={(date, time) => updateTask({ ...task, dueDate: date, dueTime: time, status: "open", notificationsEnabled: true })}
                onSnooze={(hours) => snoozeTask(task, hours)}
                onAddNote={(content) => addTaskNote(task, content)}
                onOpenRoute={canRouteToCompany(company) ? () => openCompanyRoute(company, locationState.coords) : undefined}
                onCancel={() => cancelTask(task.id)}
              />
            ))
          )}
        </>
      ) : null}

      {tab === "notes" ? (
        <Card>
          <Text style={styles.blockTitle}>Firma notlari</Text>
          {notes.length === 0 ? (
            <EmptyState title="Not yok" description="Gorevlere veya capture akisina bagli notlar burada gorunur." />
          ) : (
            notes.map((note) => (
              <View key={note.id} style={styles.lineItem}>
                <Text style={styles.lineTitle}>{note.content}</Text>
                <Text style={styles.lineSubtitle}>{new Date(note.createdAt).toLocaleString()}</Text>
              </View>
            ))
          )}
        </Card>
      ) : null}

      {tab === "offers" ? (
        offers.length === 0 ? <EmptyState title="Teklif yok" description="Bu firmaya bagli teklif bulunmuyor." /> : offers.map((offer) => <OfferSummaryCard key={offer.id} offer={offer} company={company} language={language} />)
      ) : null}

      {tab === "invoices" ? (
        invoices.length === 0 ? <EmptyState title="Fatura yok" description="Bu firmaya bagli fatura bulunmuyor." /> : invoices.map((invoice) => <InvoiceSummaryCard key={invoice.id} invoice={invoice} company={company} language={language} />)
      ) : null}

      {tab === "documents" ? (
        documents.length === 0 ? <EmptyState title="Belge yok" description="Bu firmaya bagli belge bulunmuyor." /> : documents.map((document) => <DocumentSummaryCard key={document.id} document={document} companies={data.companies} />)
      ) : null}

      {tab === "timeline" ? <TimelineCardList entries={timeline} /> : null}

      {tab === "next" ? (
        <Card>
          <Text style={styles.blockTitle}>Sonraki adim oneri seti</Text>
          <View style={styles.nextGrid}>
            {[
              "Musteriyi ara",
              "Teklif takip mesaji gonder",
              "Daha ekonomik alternatif hazirla",
              "Olcum icin ziyaret planla",
              "Odeme hatirlatmasi olustur",
              "Belge/sozlesme iste"
            ].map((suggestion) => (
              <View key={suggestion} style={styles.nextPill}>
                <Text style={styles.nextText}>{suggestion}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <SheetModal
        visible={taskComposerOpen}
        onClose={() => setTaskComposerOpen(false)}
        title="Firma gorevi"
        subtitle="Bu musterinin operasyon akisina hizli bir gorev ekleyin."
        footer={
          <>
            <PrimaryButton
              label="Kaydet"
              onPress={async () => {
                await createTask({
                  companyId: company.id,
                  title: taskTitle,
                  description: `${company.name} icin mobilde olusturuldu`,
                  type: "todo",
                  moduleIds: ["module-todo"],
                  dueDate: new Date().toISOString().slice(0, 10)
                });
                setTaskTitle("");
                setTaskComposerOpen(false);
              }}
            />
            <GhostButton label="Vazgec" onPress={() => setTaskComposerOpen(false)} />
          </>
        }
      >
        <TextField label="Gorev basligi" value={taskTitle} onChangeText={setTaskTitle} placeholder="Ornek: Teklif follow-up ara" />
      </SheetModal>

      <SheetModal
        visible={companyEditorOpen}
        onClose={() => setCompanyEditorOpen(false)}
        title="Firma bilgileri"
        subtitle="Adres, telefon ve ilgili kisi alanlarini guncelleyin."
        footer={
          <>
            <PrimaryButton
              label="Kaydet"
              onPress={async () => {
                await updateCompany({
                  ...company,
                  name: companyName,
                  address: companyAddress,
                  phone: companyPhone,
                  email: companyEmail,
                  contactPerson: companyContact
                });
                setCompanyEditorOpen(false);
              }}
            />
            <GhostButton label="Vazgec" onPress={() => setCompanyEditorOpen(false)} />
          </>
        }
      >
        <TextField label="Firma adi" value={companyName} onChangeText={setCompanyName} />
        <TextField label="Adres" value={companyAddress} onChangeText={setCompanyAddress} multiline style={styles.editorMultiline} />
        <TextField label="Telefon" value={companyPhone} onChangeText={setCompanyPhone} keyboardType="phone-pad" />
        <TextField label="E-posta" value={companyEmail} onChangeText={setCompanyEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextField label="Ilgili kisi" value={companyContact} onChangeText={setCompanyContact} />
      </SheetModal>
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
  headerRow: {
    gap: 8
  },
  editAddressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  headerActions: {
    gap: 8,
    marginTop: 4
  },
  deleteLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginTop: 4
  },
  deleteLinkText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "500"
  },
  address: {
    color: colors.textSoft,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20
  },
  contact: {
    color: colors.muted,
    fontSize: 12
  },
  blockTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2
  },
  lineItem: {
    gap: 3,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  lineTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500"
  },
  lineSubtitle: {
    color: colors.muted,
    fontSize: 12
  },
  editorMultiline: {
    minHeight: 100,
    textAlignVertical: "top"
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  metricCard: {
    flex: 1,
    minWidth: 140,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 3
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  metricValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.3
  },
  nextGrid: {
    gap: 8
  },
  nextPill: {
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  nextText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500"
  }
});
