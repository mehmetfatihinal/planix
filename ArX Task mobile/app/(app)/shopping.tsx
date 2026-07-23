import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AppHeader } from "@/components/app-header";
import { Card, Chip, EmptyState, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import {
  createShoppingItem,
  deleteShoppingItem,
  listShoppingItems,
  updateShoppingItem
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import type { ShoppingItem } from "@/types/business";

// R11 — shopping list. Open items are also fed into the geofence sync (via
// /shopping-items/sellers in app-data-context): passing near a seller of an open item
// fires a "🛒 ... alınacak" notification.
export default function ShoppingScreen() {
  const { token } = useAuth();
  const { t } = useI18n();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [chainDraft, setChainDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const rows = await listShoppingItems(token);
      setItems(rows);
    } catch {
      // Offline / older backend → keep what we have.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const openItems = useMemo(() => items.filter((item) => item.status !== "done"), [items]);
  const doneItems = useMemo(() => items.filter((item) => item.status === "done"), [items]);

  async function addItem() {
    const name = nameDraft.trim();
    if (!token || !name || adding) return;
    setAdding(true);
    try {
      const created = await createShoppingItem(token, {
        name,
        category: categoryDraft.trim() || null,
        chain: chainDraft.trim() || null
      });
      setItems((current) => [created, ...current]);
      setNameDraft("");
      setCategoryDraft("");
      setChainDraft("");
    } catch (error) {
      Alert.alert("Eklenemedi", error instanceof Error ? error.message : "Alışveriş kalemi eklenemedi.");
    } finally {
      setAdding(false);
    }
  }

  async function completeItem(item: ShoppingItem) {
    if (!token || busyItemId) return;
    setBusyItemId(item.id);
    try {
      const updated = await updateShoppingItem(token, item.id, { status: "done" });
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, ...updated, status: "done" } : row)));
    } catch (error) {
      Alert.alert("Güncellenemedi", error instanceof Error ? error.message : "Kalem tamamlanamadı.");
    } finally {
      setBusyItemId(null);
    }
  }

  async function removeItem(item: ShoppingItem) {
    if (!token || busyItemId) return;
    setBusyItemId(item.id);
    try {
      await deleteShoppingItem(token, item.id);
      setItems((current) => current.filter((row) => row.id !== item.id));
    } catch (error) {
      Alert.alert("Silinemedi", error instanceof Error ? error.message : "Kalem silinemedi.");
    } finally {
      setBusyItemId(null);
    }
  }

  return (
    <Screen withTabs onRefresh={() => void load()} refreshing={refreshing}>
      <AppHeader
        title="Alışveriş Listesi"
        subtitle="Alınacaklar listenizi tutun — satıcı firmaların yakınından geçerken hatırlatma alırsınız."
      />

      <Card>
        <Text style={styles.sectionTitle}>Yeni kalem</Text>
        <TextField label="Ürün" value={nameDraft} onChangeText={setNameDraft} placeholder="Örnek: LED şerit 5m" />
        <TextField
          label={t("shopping.field.category")}
          value={categoryDraft}
          onChangeText={setCategoryDraft}
          placeholder={t("shopping.field.categoryPlaceholder")}
        />
        <TextField
          label={t("shopping.field.chain")}
          value={chainDraft}
          onChangeText={setChainDraft}
          placeholder={t("shopping.field.chainPlaceholder")}
          autoCapitalize="characters"
        />
        <PrimaryButton
          label={adding ? "Ekleniyor..." : "Listeye ekle"}
          loading={adding}
          disabled={!nameDraft.trim()}
          onPress={() => void addItem()}
        />
      </Card>

      <Card>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Alınacaklar</Text>
          <Chip label={`${openItems.length} kalem`} tone={openItems.length ? "warning" : "success"} />
        </View>
        {loading ? (
          <Text style={styles.loadingText}>Yükleniyor...</Text>
        ) : openItems.length === 0 ? (
          <EmptyState title="Liste boş" description="İlk alışveriş kalemini ekleyin — yakındaki satıcılarda bildirim alırsınız." />
        ) : (
          openItems.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <Pressable
                onPress={() => void completeItem(item)}
                style={[styles.checkButton, busyItemId === item.id && { opacity: 0.5 }]}
                disabled={busyItemId === item.id}
              >
                <Feather name="check" size={15} color={colors.success} />
              </Pressable>
              <View style={styles.itemCopy}>
                <Text style={styles.itemTitle}>{item.name}</Text>
                {item.category ? <Text style={styles.itemMeta}>{item.category}</Text> : null}
                {item.chain ? (
                  <View style={styles.chainBadgeRow}>
                    <Chip label={item.chain} />
                  </View>
                ) : null}
              </View>
              <Pressable
                onPress={() =>
                  Alert.alert("Kalemi sil", `"${item.name}" listeden silinecek.`, [
                    { text: "Vazgeç", style: "cancel" },
                    { text: "Sil", style: "destructive", onPress: () => void removeItem(item) }
                  ])
                }
                style={styles.deleteButton}
              >
                <Feather name="trash-2" size={15} color={colors.danger} />
              </Pressable>
            </View>
          ))
        )}
      </Card>

      {doneItems.length ? (
        <Card variant="muted">
          <Text style={styles.sectionTitle}>Alınanlar</Text>
          {doneItems.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <Feather name="check-circle" size={16} color={colors.success} />
              <View style={styles.itemCopy}>
                <Text style={[styles.itemTitle, styles.itemTitleDone]}>{item.name}</Text>
              </View>
              <Pressable onPress={() => void removeItem(item)} style={styles.deleteButton}>
                <Feather name="trash-2" size={15} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  checkButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(63,155,120,0.4)",
    backgroundColor: "rgba(63,155,120,0.10)",
    alignItems: "center",
    justifyContent: "center"
  },
  itemCopy: {
    flex: 1,
    gap: 2
  },
  itemTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500"
  },
  itemTitleDone: {
    color: colors.muted,
    textDecorationLine: "line-through"
  },
  itemMeta: {
    color: colors.muted,
    fontSize: 12
  },
  chainBadgeRow: {
    flexDirection: "row",
    marginTop: 2
  },
  deleteButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  }
});
