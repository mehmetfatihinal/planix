import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card, Chip, GhostButton, colors } from "@/components/ui";
import { companyById, formatCurrency, formatDateLabel, formatDateTimeLabel, formatPercent, statusLabel } from "@/lib/format";
import type { Company, DocumentRecord, Invoice, Offer, Product, TimelineEntry } from "@/types/business";

export function FilterChips<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.filterRow}>
      {options.map((option) => (
        <Pressable key={option.value} onPress={() => onChange(option.value)}>
          <Chip label={option.label} tone={option.value === value ? "success" : "default"} />
        </Pressable>
      ))}
    </View>
  );
}

export function OfferSummaryCard({
  offer,
  company,
  language,
  actions
}: {
  offer: Offer;
  company?: Company | null;
  language: string;
  actions?: ReactNode;
}) {
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={styles.flexCopy}>
          <Text style={styles.kicker}>{offer.offerNumber}</Text>
          <Text style={styles.title}>{offer.title}</Text>
          <Text style={styles.subtle}>{company?.name ?? "Firma bagli degil"}</Text>
        </View>
        <Chip label={statusLabel(offer.status)} tone={offer.status === "accepted" ? "success" : offer.status === "sent" ? "warning" : "default"} />
      </View>
      <View style={styles.metaGrid}>
        <MetaBox icon="calendar" label="Tarih" value={formatDateLabel(offer.offerDate, language)} />
        <MetaBox icon="clock" label="Gecerlilik" value={`${offer.validityDays} gun`} />
        <MetaBox icon="package" label="Kalem" value={String(offer.items.length)} />
        <MetaBox icon="credit-card" label="Toplam" value={formatCurrency(offer.total, language)} />
      </View>
      {offer.items.slice(0, 3).map((item) => (
        <View key={item.id} style={styles.lineRow}>
          <View style={styles.flexCopy}>
            <Text style={styles.lineTitle}>{item.productName}</Text>
            <Text style={styles.subtle}>{item.quantity} x {formatCurrency(item.unitPrice, language)}</Text>
          </View>
          <Text style={styles.lineStrong}>{formatCurrency(item.totalPrice, language)}</Text>
        </View>
      ))}
      {actions ? <View style={styles.actionRow}>{actions}</View> : null}
    </Card>
  );
}

export function InvoiceSummaryCard({
  invoice,
  company,
  language,
  actions
}: {
  invoice: Invoice;
  company?: Company | null;
  language: string;
  actions?: ReactNode;
}) {
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={styles.flexCopy}>
          <Text style={styles.kicker}>{invoice.invoiceNumber}</Text>
          <Text style={styles.title}>{company?.name ?? "Firma bagli degil"}</Text>
          <Text style={styles.subtle}>Vade: {formatDateLabel(invoice.dueDate, language)}</Text>
        </View>
        <Chip label={statusLabel(invoice.status)} tone={invoice.status === "paid" ? "success" : invoice.status === "overdue" ? "danger" : "warning"} />
      </View>
      <View style={styles.metaGrid}>
        <MetaBox icon="calendar" label="Fatura tarihi" value={formatDateLabel(invoice.invoiceDate, language)} />
        <MetaBox icon="package" label="Kalem" value={String(invoice.items.length)} />
        <MetaBox icon="credit-card" label="Toplam" value={formatCurrency(invoice.total, language)} />
        <MetaBox icon="check-circle" label="Odeme" value={invoice.paidAt ? formatDateTimeLabel(invoice.paidAt, language) : "Bekliyor"} />
      </View>
      {actions ? <View style={styles.actionRow}>{actions}</View> : null}
    </Card>
  );
}

export function ProductSummaryCard({ product, language }: { product: Product; language: string }) {
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={styles.flexCopy}>
          <Text style={styles.title}>{product.name}</Text>
          <Text style={styles.subtle}>{product.category}</Text>
        </View>
        <Chip label={formatPercent(product.margin, language)} tone={product.margin > 0.35 ? "success" : "warning"} />
      </View>
      <Text style={styles.bodyText}>{product.description || "Aciklama girilmedi."}</Text>
      <View style={styles.metaGrid}>
        <MetaBox icon="shopping-bag" label="Maliyet" value={formatCurrency(product.costPrice, language)} />
        <MetaBox icon="tag" label="Satis" value={formatCurrency(product.sellingPrice, language)} />
        <MetaBox icon="shield" label="Minimum" value={formatCurrency(product.minimumPrice, language)} />
        <MetaBox icon="refresh-cw" label="Guncel" value={formatDateLabel(product.updatedAt.slice(0, 10), language)} />
      </View>
    </Card>
  );
}

export function DocumentSummaryCard({
  document,
  companies,
  actions
}: {
  document: DocumentRecord;
  companies: Company[];
  actions?: ReactNode;
}) {
  const company = companyById(companies, document.companyId);
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={styles.flexCopy}>
          <Text style={styles.title}>{document.fileName}</Text>
          <Text style={styles.subtle}>{company?.name ?? "Firma bagli degil"}</Text>
        </View>
        <Chip label={document.documentType} />
      </View>
      <Text style={styles.bodyText}>{document.summary || "Ozet yok."}</Text>
      <View style={styles.metaGrid}>
        <MetaBox icon="file-text" label="Dosya tipi" value={document.fileType} />
        <MetaBox icon="clock" label="Yuklendi" value={formatDateTimeLabel(document.uploadedAt, "tr")} />
      </View>
      {actions ? <View style={styles.actionRow}>{actions}</View> : null}
    </Card>
  );
}

export function TimelineCardList({ entries }: { entries: TimelineEntry[] }) {
  return (
    <Card>
      <Text style={styles.title}>Zaman cizelgesi</Text>
      {entries.length === 0 ? (
        <Text style={styles.subtle}>Bu baglamda zaman cizelgesi kaydi yok.</Text>
      ) : (
        entries.map((entry) => (
          <View key={entry.id} style={styles.timelineRow}>
            <View style={styles.timelineDot} />
            <View style={styles.flexCopy}>
              <Text style={styles.lineTitle}>{entry.title}</Text>
              <Text style={styles.subtle}>{entry.description}</Text>
              <Text style={styles.timelineDate}>{formatDateTimeLabel(entry.date, "tr")}</Text>
            </View>
          </View>
        ))
      )}
    </Card>
  );
}

export function InlineAction({
  label,
  onPress,
  icon,
  tone = "default"
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  tone?: "default" | "danger";
}) {
  return (
    <GhostButton
      label={label}
      onPress={onPress}
    />
  );
}

function MetaBox({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.metaBox}>
      <View style={styles.metaIcon}>
        <Feather name={icon} size={12} color={colors.muted} />
      </View>
      <View style={styles.flexCopy}>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.metaValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10
  },
  flexCopy: {
    flex: 1,
    gap: 3
  },
  kicker: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2
  },
  subtle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  bodyText: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 18
  },
  metaGrid: {
    gap: 6
  },
  metaBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  metaIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceStrong
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  metaValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500"
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8
  },
  lineTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500"
  },
  lineStrong: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600"
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  timelineRow: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  timelineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.muted,
    marginTop: 7
  },
  timelineDate: {
    color: colors.subtle,
    fontSize: 11,
    marginTop: 2
  }
});
