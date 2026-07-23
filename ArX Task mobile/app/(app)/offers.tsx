import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppHeader } from "@/components/app-header";
import { FilterChips, OfferSummaryCard } from "@/components/operations-cards";
import { SheetModal } from "@/components/sheet-modal";
import { Card, EmptyState, GhostButton, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { useAppData } from "@/lib/app-data-context";
import { useAuth } from "@/lib/auth-context";
import { companyById } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { shareOfferPdf } from "@/lib/pdf-share";
import type { Offer, OfferKind, OfferStatus } from "@/types/business";

type OfferFilter = "all" | "pending" | "lost" | "packages";

export default function OffersScreen() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const { token } = useAuth();
  const { data, createOffer, acceptOffer, convertOfferToInvoice, deleteOffer, sendOffer, refresh, refreshing } = useAppData();
  const { language } = useI18n();
  const [sharingId, setSharingId] = useState<string | null>(null);

  async function handleSharePdf(offer: Offer) {
    if (!token || sharingId) return;
    setSharingId(offer.id);
    try {
      await shareOfferPdf(token, offer);
    } catch (error) {
      Alert.alert("PDF paylaşılamadı", error instanceof Error ? error.message : "Teklif PDF'i indirilemedi.");
    } finally {
      setSharingId(null);
    }
  }
  const [filter, setFilter] = useState<OfferFilter>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerKind, setComposerKind] = useState<OfferKind>("offer");
  const [companyId, setCompanyId] = useState(data.companies[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");

  // Initial url params (?view=create|pending|lost|packages) drive the entry state.
  useEffect(() => {
    if (!view) return;
    if (view === "create") {
      setComposerOpen(true);
      setComposerKind("offer");
    } else if (view === "create-package") {
      setComposerOpen(true);
      setComposerKind("package");
    } else if (view === "pending" || view === "lost" || view === "packages") {
      setFilter(view as OfferFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const offers = useMemo(() => {
    if (filter === "packages") return data.offers.filter((item) => item.kind === "package");
    const nonPackage = data.offers.filter((item) => item.kind !== "package");
    if (filter === "pending") return nonPackage.filter((item) => ["draft", "prepared", "sent", "followUpNeeded"].includes(item.status));
    if (filter === "lost") return nonPackage.filter((item) => item.status === "rejected");
    return nonPackage;
  }, [data.offers, filter]);

  return (
    <Screen withTabs onRefresh={refresh} refreshing={refreshing}>
      <AppHeader title={filter === "packages" ? "Paketler" : "Teklifler"} subtitle="Hazır, gönderilen ve takip bekleyen teklif akışları." />
      <View style={styles.topRow}>
        <FilterChips
          options={[
            { label: "Tümü", value: "all" },
            { label: "Bekleyen", value: "pending" },
            { label: "Kaybedilen", value: "lost" },
            { label: "Paketler", value: "packages" }
          ]}
          value={filter}
          onChange={(next) => setFilter(next)}
        />
        <PrimaryButton
          label={filter === "packages" ? "Paket oluştur" : "Teklif oluştur"}
          onPress={() => {
            setComposerKind(filter === "packages" ? "package" : "offer");
            setComposerOpen(true);
          }}
        />
      </View>

      {offers.length === 0 ? (
        <EmptyState
          title={filter === "packages" ? "Henüz paket yok" : "Teklif yok"}
          description={filter === "packages" ? "Tekrar tekrar kullanılacak fiyat paketlerini buradan oluştur." : "Mobilde ilk teklif kaydını oluşturduğunuzda burada listelenir."}
        />
      ) : (
        offers.map((offer) => (
          <OfferSummaryCard
            key={offer.id}
            offer={offer}
            company={companyById(data.companies, offer.companyId)}
            language={language}
            actions={
              <>
                {offer.kind === "offer" && offer.status !== "sent" ? <GhostButton label="Gönder" onPress={() => void sendOffer(offer.id)} /> : null}
                {offer.kind === "offer" && offer.status !== "accepted" ? <GhostButton label="Kabul et" onPress={() => void acceptOffer(offer.id)} /> : null}
                {offer.kind === "offer" ? <GhostButton label="Faturaya çevir" onPress={() => void convertOfferToInvoice(offer.id)} /> : null}
                <GhostButton label={sharingId === offer.id ? "PDF hazırlanıyor..." : "PDF paylaş"} onPress={() => void handleSharePdf(offer)} />
                <GhostButton label="Sil" onPress={() => void deleteOffer(offer.id)} />
              </>
            }
          />
        ))
      )}

      <SheetModal
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        title={composerKind === "package" ? "Yeni paket" : "Yeni teklif"}
        subtitle={composerKind === "package" ? "Tekrar tekrar kullanacağın fiyat paketi." : "Hızlı teklif oluşturup satış akışına ekleyin."}
        footer={
          <>
            <PrimaryButton
              label="Kaydet"
              onPress={async () => {
                await createOffer({
                  companyId,
                  title,
                  status: "draft" as OfferStatus,
                  kind: composerKind,
                  items: [
                    {
                      id: `item-${Date.now()}`,
                      productName: productName || "Service",
                      description: "",
                      quantity: 1,
                      unitPrice: Number(price || 0),
                      totalPrice: Number(price || 0)
                    }
                  ]
                });
                setComposerOpen(false);
                setTitle("");
                setProductName("");
                setPrice("");
                setComposerKind("offer");
              }}
            />
            <GhostButton label="Vazgeç" onPress={() => setComposerOpen(false)} />
          </>
        }
      >
        <View style={styles.kindRow}>
          <Pressable onPress={() => setComposerKind("offer")} style={[styles.kindChip, composerKind === "offer" && styles.kindChipActive]}>
            <Text style={[styles.kindText, composerKind === "offer" && styles.kindTextActive]}>Teklif</Text>
          </Pressable>
          <Pressable onPress={() => setComposerKind("package")} style={[styles.kindChip, composerKind === "package" && styles.kindChipActive]}>
            <Text style={[styles.kindText, composerKind === "package" && styles.kindTextActive]}>Paket</Text>
          </Pressable>
        </View>
        <TextField label="Başlık" value={title} onChangeText={setTitle} placeholder={composerKind === "package" ? "Örnek: Başlangıç paketi" : "Örnek: 3 paket menü ekran teklifi"} />
        <TextField label="Firma ID" value={companyId} onChangeText={setCompanyId} placeholder={data.companies[0]?.id ?? "company-id"} />
        <TextField label="İlk ürün/hizmet" value={productName} onChangeText={setProductName} placeholder="Örnek: LED Display" />
        <TextField label="Toplam fiyat" value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="1350" />
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
    fontWeight: "600"
  },
  companyRow: {
    flexDirection: "row",
    gap: 10
  },
  kindRow: {
    flexDirection: "row",
    gap: 6
  },
  kindChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    alignItems: "center"
  },
  kindChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  kindText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500"
  },
  kindTextActive: {
    color: colors.text
  }
});
