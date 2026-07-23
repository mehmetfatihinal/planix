import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppHeader } from "@/components/app-header";
import { FilterChips, ProductSummaryCard } from "@/components/operations-cards";
import { SheetModal } from "@/components/sheet-modal";
import { EmptyState, GhostButton, PrimaryButton, Screen, TextField } from "@/components/ui";
import { useAppData } from "@/lib/app-data-context";
import { formatPercent } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function ProductsScreen() {
  const { data, createProduct, deleteProduct } = useAppData();
  const { language } = useI18n();
  const [composerOpen, setComposerOpen] = useState(false);
  const [category, setCategory] = useState("all");
  const [name, setName] = useState("");
  const [productCategory, setProductCategory] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");

  const categories = useMemo(() => ["all", ...Array.from(new Set(data.products.map((product) => product.category)))], [data.products]);
  const products = category === "all" ? data.products : data.products.filter((product) => product.category === category);

  return (
    <Screen withTabs>
      <AppHeader title="Urunler" subtitle="Fiyatlar, minimum seviyeler ve marjlari mobilde yonetin." />
      <View style={styles.topRow}>
        <FilterChips
          options={categories.map((item) => ({ label: item === "all" ? "Tum kategoriler" : item, value: item }))}
          value={category}
          onChange={setCategory}
        />
        <PrimaryButton label="Urun ekle" onPress={() => setComposerOpen(true)} />
      </View>

      {products.length === 0 ? (
        <EmptyState title="Urun yok" description="Ilk urun kaydini mobilde ekleyebilirsiniz." />
      ) : (
        products.map((product) => <ProductSummaryCard key={product.id} product={product} language={language} />)
      )}

      <SheetModal
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Yeni urun"
        subtitle="Teklif ve fatura akisinda kullanilacak urun/fiyat kaydi."
        footer={
          <>
            <PrimaryButton
              label="Kaydet"
              onPress={async () => {
                await createProduct({
                  name,
                  category: productCategory,
                  costPrice: Number(cost || 0),
                  sellingPrice: Number(price || 0),
                  minimumPrice: Number(price || 0)
                });
                setComposerOpen(false);
                setName("");
                setProductCategory("");
                setPrice("");
                setCost("");
              }}
            />
            <GhostButton label="Vazgec" onPress={() => setComposerOpen(false)} />
          </>
        }
      >
        <TextField label="Urun adi" value={name} onChangeText={setName} placeholder="Ornek: 65 inch display" />
        <TextField label="Kategori" value={productCategory} onChangeText={setProductCategory} placeholder="Displays" />
        <TextField label="Maliyet" value={cost} onChangeText={setCost} keyboardType="numeric" placeholder="600" />
        <TextField label="Satis fiyati" value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="890" />
        {price ? <Text style={styles.marginText}>Tahmini marj: {formatPercent(Number(price) > 0 ? (Number(price) - Number(cost || 0)) / Number(price) : 0, language)}</Text> : null}
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    gap: 12
  },
  marginText: {
    color: "#7f6f64",
    fontSize: 13
  }
});
