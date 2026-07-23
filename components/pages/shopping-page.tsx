"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { formatShortDate } from "@/lib/format";
import { Badge, Button, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui/ui-kit";
import type { ShoppingItem } from "@/types/business";

// Yaygın alışveriş kategorileri — kategori alanına öneri (datalist) olarak sunulur.
const CATEGORY_PRESETS = ["market", "kasap", "manav", "fırın", "eczane", "kitapçı"];

export function ShoppingPage() {
  const { t, language, fetchShoppingItems, createShoppingItem, updateShoppingItem, deleteShoppingItem } = useAppState();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [chain, setChain] = useState("");
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchShoppingItems());
    } catch {
      // keep the current list when the API is unreachable
    } finally {
      setLoading(false);
    }
  }, [fetchShoppingItems]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addItem(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      await createShoppingItem({
        name: trimmed,
        category: category.trim() || null,
        chain: chain.trim() || null
      });
      setName("");
      setCategory("");
      setChain("");
      await load();
    } finally {
      setAdding(false);
    }
  }

  async function completeItem(item: ShoppingItem) {
    setBusyIds((current) => [...current, item.id]);
    try {
      await updateShoppingItem(item.id, { ...item, status: "done" });
      await load();
    } finally {
      setBusyIds((current) => current.filter((id) => id !== item.id));
    }
  }

  async function removeItem(item: ShoppingItem) {
    setBusyIds((current) => [...current, item.id]);
    try {
      await deleteShoppingItem(item.id);
      await load();
    } finally {
      setBusyIds((current) => current.filter((id) => id !== item.id));
    }
  }

  const openItems = items.filter((item) => item.status !== "done");
  const doneItems = items.filter((item) => item.status === "done");

  return (
    <div className="space-y-6">
      <PageHeader title={t("shopping.title")} subtitle={t("shopping.subtitle")} />
      <Card>
        <SectionTitle title={t("shopping.addTitle")} icon={Plus} />
        <form onSubmit={addItem} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_180px_170px_auto]">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("shopping.namePlaceholder")}
            className="min-h-11 rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
          />
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder={t("shopping.categoryPlaceholder")}
            list="shopping-category-presets"
            className="min-h-11 rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
          />
          <datalist id="shopping-category-presets">
            {CATEGORY_PRESETS.map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
          <input
            value={chain}
            onChange={(event) => setChain(event.target.value)}
            placeholder={t("shopping.chainPlaceholder")}
            className="min-h-11 rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
          />
          <Button type="submit" disabled={!name.trim() || adding}>
            <Plus size={16} />
            {t("shopping.add")}
          </Button>
        </form>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle title={t("shopping.open")} icon={ShoppingCart} />
          {loading ? (
            <p className="text-sm text-muted dark:text-darkMuted">{t("admin.loading")}</p>
          ) : openItems.length === 0 ? (
            <EmptyState title={t("shopping.empty")} />
          ) : (
            <div className="space-y-2">
              {openItems.map((item) => {
                const busy = busyIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#E8DECF] bg-white p-3 dark:border-darkBorder dark:bg-[#202020]"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-semibold text-text dark:text-[#F5F0EA]">{item.name}</p>
                        {item.chain ? <Badge tone="primary">{item.chain}</Badge> : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted dark:text-darkMuted">
                        {item.category ? `${item.category} · ` : ""}
                        {formatShortDate(item.createdAt, language)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="secondary" disabled={busy} onClick={() => void completeItem(item)}>
                        <Check size={16} />
                        {t("shopping.complete")}
                      </Button>
                      <Button variant="ghost" disabled={busy} onClick={() => void removeItem(item)}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle title={t("shopping.done")} icon={Check} />
          {doneItems.length === 0 ? (
            <EmptyState title={t("shopping.emptyDone")} />
          ) : (
            <div className="space-y-2">
              {doneItems.map((item) => {
                const busy = busyIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#E8DECF] bg-white/70 p-3 dark:border-darkBorder dark:bg-[#202020]/70"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-muted line-through dark:text-darkMuted">{item.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {item.category ? <Badge>{item.category}</Badge> : null}
                        {item.chain ? <Badge tone="primary">{item.chain}</Badge> : null}
                        {item.completedAt ? (
                          <span className="text-xs text-muted/80 dark:text-darkMuted/80">
                            {formatShortDate(item.completedAt, language)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Button variant="ghost" disabled={busy} onClick={() => void removeItem(item)}>
                      <Trash2 size={16} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
