import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppHeader } from "@/components/app-header";
import { FilterChips, InvoiceSummaryCard } from "@/components/operations-cards";
import { SheetModal } from "@/components/sheet-modal";
import { Card, EmptyState, GhostButton, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { useAppData } from "@/lib/app-data-context";
import { useAuth } from "@/lib/auth-context";
import { companyById } from "@/lib/format";
import { shareInvoicePdf } from "@/lib/pdf-share";
import type { Invoice, InvoiceStatus } from "@/types/business";

type InvoiceFilter = "all" | "waiting" | "paid";

export default function InvoicesScreen() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const { token } = useAuth();
  const { data, createInvoice, deleteInvoice, markInvoicePaid, updateTask, createTask, refresh, refreshing } = useAppData();
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [sharingId, setSharingId] = useState<string | null>(null);

  async function handleSharePdf(invoice: Invoice) {
    if (!token || sharingId) return;
    setSharingId(invoice.id);
    try {
      await shareInvoicePdf(token, invoice);
    } catch (error) {
      Alert.alert("PDF paylaşılamadı", error instanceof Error ? error.message : "Fatura PDF'i indirilemedi.");
    } finally {
      setSharingId(null);
    }
  }
  const [composerOpen, setComposerOpen] = useState(false);
  const [companyId, setCompanyId] = useState(data.companies[0]?.id ?? "");
  const [itemName, setItemName] = useState("");
  const [price, setPrice] = useState("");

  // ?view=create → composer açık başlar; ?view=waiting|paid → filter set.
  useEffect(() => {
    if (!view) return;
    if (view === "create") {
      setComposerOpen(true);
    } else if (view === "waiting" || view === "paid") {
      setFilter(view as InvoiceFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const invoices = useMemo(() => {
    if (filter === "waiting") return data.invoices.filter((item) => ["unpaid", "overdue", "partiallyPaid"].includes(item.status));
    if (filter === "paid") return data.invoices.filter((item) => item.status === "paid");
    return data.invoices;
  }, [data.invoices, filter]);

  return (
    <Screen withTabs onRefresh={refresh} refreshing={refreshing}>
      <AppHeader title="Faturalar" subtitle="Bekleyen, geciken ve odenen tahsilat akislarini mobilde yonetin." />
      <View style={styles.topRow}>
        <FilterChips
          options={[
            { label: "Tum faturalar", value: "all" },
            { label: "Bekleyen", value: "waiting" },
            { label: "Odendi", value: "paid" }
          ]}
          value={filter}
          onChange={setFilter}
        />
        <PrimaryButton label="Fatura olustur" onPress={() => setComposerOpen(true)} />
      </View>

      {invoices.length === 0 ? (
        <EmptyState title="Fatura yok" description="Ilk tahsilat kaydi bu ekranda gorunecek." />
      ) : (
        invoices.map((invoice) => (
          <InvoiceSummaryCard
            key={invoice.id}
            invoice={invoice}
            company={companyById(data.companies, invoice.companyId)}
            language="tr"
            actions={
              <>
                {invoice.status !== "paid" ? <GhostButton label="Odendi" onPress={() => void markInvoicePaid(invoice.id)} /> : null}
                <GhostButton
                  label="Takip gorevi"
                  onPress={() =>
                    void createTask({
                      companyId: invoice.companyId,
                      title: `Odeme takibi: ${invoice.invoiceNumber}`,
                      description: "Mobil faturadan olusturulan takip gorevi",
                      type: "payments",
                      moduleIds: ["module-payments"],
                      priority: "high"
                    })
                  }
                />
                <GhostButton label={sharingId === invoice.id ? "PDF hazırlanıyor..." : "PDF paylaş"} onPress={() => void handleSharePdf(invoice)} />
                <GhostButton label="Sil" onPress={() => void deleteInvoice(invoice.id)} />
              </>
            }
          />
        ))
      )}

      <SheetModal
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Yeni fatura"
        subtitle="Hizli fatura kaydi olusturup odeme akisini takip edin."
        footer={
          <>
            <PrimaryButton
              label="Kaydet"
              onPress={async () => {
                await createInvoice({
                  companyId,
                  status: "unpaid" as InvoiceStatus,
                  items: [
                    {
                      id: `item-${Date.now()}`,
                      productName: itemName || "Service",
                      description: "",
                      quantity: 1,
                      unitPrice: Number(price || 0),
                      totalPrice: Number(price || 0)
                    }
                  ]
                });
                setComposerOpen(false);
                setItemName("");
                setPrice("");
              }}
            />
            <GhostButton label="Vazgec" onPress={() => setComposerOpen(false)} />
          </>
        }
      >
        <TextField label="Firma ID" value={companyId} onChangeText={setCompanyId} placeholder={data.companies[0]?.id ?? "company-id"} />
        <TextField label="Kalem" value={itemName} onChangeText={setItemName} placeholder="Ornek: Menu design" />
        <TextField label="Toplam fiyat" value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="890" />
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
