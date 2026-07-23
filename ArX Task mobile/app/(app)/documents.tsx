import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppHeader } from "@/components/app-header";
import { DocumentSummaryCard, FilterChips } from "@/components/operations-cards";
import { SheetModal } from "@/components/sheet-modal";
import { Card, EmptyState, GhostButton, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { useAppData } from "@/lib/app-data-context";

type DocumentFilter = "all" | "pdf" | "photo" | "contract" | "measurement" | "priceList";

export default function DocumentsScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const { data, createDocument, deleteDocument } = useAppData();
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [companyId, setCompanyId] = useState(data.companies[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [documentType, setDocumentType] = useState("PDF");
  const [summary, setSummary] = useState("");

  useEffect(() => {
    if (!type) return;
    if (["pdf", "photo", "contract", "measurement", "priceList"].includes(type)) {
      setFilter(type as DocumentFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const documents = useMemo(() => {
    return data.documents.filter((document) => {
      const text = `${document.documentType} ${document.fileType} ${document.fileName}`.toLowerCase();
      if (filter === "all") return true;
      if (filter === "pdf") return text.includes("pdf");
      if (filter === "photo") return text.includes("photo") || text.includes("image/");
      if (filter === "contract") return text.includes("contract") || text.includes("sözleş") || text.includes("sozles");
      if (filter === "measurement") return text.includes("measurement") || text.includes("ölç") || text.includes("olc");
      if (filter === "priceList") return text.includes("price") || text.includes("fiyat") || text.includes("liste") || text.includes("pricelist");
      return true;
    });
  }, [data.documents, filter]);

  return (
    <Screen withTabs>
      <AppHeader title="Dokumanlar" subtitle="Belge ozeti, tipi ve firma baglantisini tek ekranda gorun." />
      <View style={styles.topRow}>
        <FilterChips
          options={[
            { label: "Tüm belgeler", value: "all" },
            { label: "PDF", value: "pdf" },
            { label: "Foto", value: "photo" },
            { label: "Sözleşme", value: "contract" },
            { label: "Ölçüm", value: "measurement" },
            { label: "Fiyat Listeleri", value: "priceList" }
          ]}
          value={filter}
          onChange={setFilter}
        />
        <PrimaryButton label="Belge metadata ekle" onPress={() => setComposerOpen(true)} />
      </View>

      <Card variant="muted">
        <Text style={styles.flowTitle}>Upload akis ozetı</Text>
        <Text style={styles.flowText}>1. Belge yukle  2. Ozet/ocr  3. Firma bagla  4. Operasyon akisina dusur</Text>
      </Card>

      {documents.length === 0 ? (
        <EmptyState title="Belge yok" description="Ilk dokuman kaydini burada goreceksiniz." />
      ) : (
        documents.map((document) => (
          <DocumentSummaryCard
            key={document.id}
            document={document}
            companies={data.companies}
            actions={<GhostButton label="Sil" onPress={() => void deleteDocument(document.id)} />}
          />
        ))
      )}

      <SheetModal
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Belge metadata"
        subtitle="Mobilde belge kaydi acip firma akisini besleyin."
        footer={
          <>
            <PrimaryButton
              label="Kaydet"
              onPress={async () => {
                await createDocument({
                  companyId,
                  fileName,
                  documentType,
                  summary,
                  fileType: documentType.toLowerCase().includes("photo") ? "image/jpeg" : "application/pdf"
                });
                setComposerOpen(false);
                setFileName("");
                setSummary("");
              }}
            />
            <GhostButton label="Vazgec" onPress={() => setComposerOpen(false)} />
          </>
        }
      >
        <TextField label="Firma ID" value={companyId} onChangeText={setCompanyId} placeholder={data.companies[0]?.id ?? "company-id"} />
        <TextField label="Dosya adi" value={fileName} onChangeText={setFileName} placeholder="olcum-raporu.pdf" />
        <TextField label="Belge tipi" value={documentType} onChangeText={setDocumentType} placeholder="PDF / Contract / Measurement photo" />
        <TextField label="Ozet" value={summary} onChangeText={setSummary} multiline style={{ minHeight: 120, textAlignVertical: "top" }} placeholder="Belgenin operasyon ozeti" />
        <Card variant="muted">
          <Text style={styles.helperTitle}>Mevcut firmalar</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.companyRow}>
              {data.companies.map((company) => (
                <GhostButton key={company.id} label={company.name} onPress={() => setCompanyId(company.id)} />
              ))}
            </View>
          </ScrollView>
        </Card>
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    gap: 12
  },
  flowTitle: {
    color: colors.text,
    fontWeight: "700"
  },
  flowText: {
    color: colors.muted,
    lineHeight: 20
  },
  helperTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700"
  },
  companyRow: {
    flexDirection: "row",
    gap: 10
  }
});
