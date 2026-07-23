import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AppHeader } from "@/components/app-header";
import { SheetModal } from "@/components/sheet-modal";
import { Card, EmptyState, GhostButton, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { useAppData } from "@/lib/app-data-context";
import { isTaskOpen } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useMemo, useState } from "react";

export default function CompaniesScreen() {
  const router = useRouter();
  const { view } = useLocalSearchParams<{ view?: string }>();
  const showingArchived = view === "archived";
  const { data, createCompany, refresh, refreshing } = useAppData();
  const { t } = useI18n();
  const [composerOpen, setComposerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const visibleCompanies = useMemo(() => {
    const base = data.companies.filter((company) =>
      showingArchived ? Boolean(company.archivedAt) : !company.archivedAt
    );
    const query = search.trim().toLocaleLowerCase("tr-TR");
    if (!query) return base;
    return base.filter((company) => {
      const haystack = `${company.name} ${company.address} ${company.phone} ${company.email} ${company.contactPerson}`.toLocaleLowerCase("tr-TR");
      return haystack.includes(query);
    });
  }, [data.companies, search, showingArchived]);

  const setView = (next: "active" | "archived") => {
    router.setParams({ view: next === "archived" ? "archived" : "" });
  };

  return (
    <Screen withTabs onRefresh={refresh} refreshing={refreshing}>
      <AppHeader
        title={showingArchived ? "Eski Firmalar" : t("companies.title")}
        subtitle={showingArchived ? "Arşivlenmiş kayıtlar — istediğin zaman geri alabilirsin." : "Aktif kayıtlar ve takip gerektiren müşteriler."}
      />

      <View style={styles.viewToggle}>
        <Pressable onPress={() => setView("active")} style={[styles.toggleChip, !showingArchived && styles.toggleChipActive]}>
          <Text style={[styles.toggleText, !showingArchived && styles.toggleTextActive]}>Aktif</Text>
        </Pressable>
        <Pressable onPress={() => setView("archived")} style={[styles.toggleChip, showingArchived && styles.toggleChipActive]}>
          <Text style={[styles.toggleText, showingArchived && styles.toggleTextActive]}>Arşiv</Text>
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <Feather name="search" size={14} color={colors.muted} style={styles.searchIcon} />
        <TextField
          value={search}
          onChangeText={setSearch}
          placeholder="Firma adı, adres veya kişi ile ara"
          autoCapitalize="none"
          style={styles.searchInput}
        />
      </View>

      {!showingArchived ? <PrimaryButton label="Firma ekle" onPress={() => setComposerOpen(true)} /> : null}

      {visibleCompanies.length === 0 ? (
        <EmptyState
          title={showingArchived ? "Arşivde firma yok" : search ? "Aramaya uygun firma yok" : t("empty.companies")}
          description={
            showingArchived
              ? "Bir firmayı arşivlediğinde burada listelenir."
              : search
                ? "Aramayı temizleyip tüm listeyi görebilirsin."
                : "İlk şirket kaydı ses analizi veya manuel girişle oluşabilir."
          }
        />
      ) : (
        visibleCompanies.map((company) => {
          const taskCount = data.tasks.filter((task) => task.companyId === company.id && isTaskOpen(task)).length;
          const offerCount = data.offers.filter((offer) => offer.companyId === company.id).length;
          return (
            <Link key={company.id} href={{ pathname: "/(app)/companies/[id]", params: { id: company.id } }} asChild>
              <Pressable>
                <Card>
                  <View style={styles.row}>
                    <View style={styles.companyBadge}>
                      <Feather name="briefcase" size={14} color={colors.textSoft} />
                    </View>
                    <View style={styles.copy}>
                      <Text style={styles.name}>{company.name}</Text>
                      <Text style={styles.address} numberOfLines={1}>{company.address || "Adres eklenmedi"}</Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={colors.subtle} />
                  </View>
                  <Text style={styles.metaLine}>
                    {company.status} · {taskCount} açık görev · {offerCount} teklif
                  </Text>
                </Card>
              </Pressable>
            </Link>
          );
        })
      )}

      <SheetModal
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Yeni firma"
        subtitle="Mobil akışlarda kullanılacak şirket kaydı."
        footer={
          <>
            <PrimaryButton
              label="Kaydet"
              onPress={async () => {
                await createCompany({ name, address, phone, email });
                setComposerOpen(false);
                setName("");
                setAddress("");
                setPhone("");
                setEmail("");
              }}
            />
            <GhostButton label="Vazgeç" onPress={() => setComposerOpen(false)} />
          </>
        }
      >
        <TextField label="Firma adı" value={name} onChangeText={setName} placeholder="Örnek: Mara Market" />
        <TextField label="Adres" value={address} onChangeText={setAddress} placeholder="Hamburg" />
        <TextField label="Telefon" value={phone} onChangeText={setPhone} placeholder="+49..." />
        <TextField label="E-posta" value={email} onChangeText={setEmail} placeholder="info@firma.de" />
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  viewToggle: {
    flexDirection: "row",
    gap: 6,
    marginTop: -4
  },
  toggleChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong
  },
  toggleChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  toggleText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500"
  },
  toggleTextActive: {
    color: colors.text
  },
  searchWrap: {
    position: "relative"
  },
  searchIcon: {
    position: "absolute",
    left: 12,
    top: 15,
    zIndex: 1
  },
  searchInput: {
    paddingLeft: 36
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  companyBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center"
  },
  copy: {
    flex: 1,
    gap: 3
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2
  },
  address: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  metaLine: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2
  }
});
