import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { SecurityDepositReceiptData } from "@/utils/security-deposit-receipt";
import { formatDepositStatus } from "./leases-utils";

export type SecurityDepositReceiptPdfKind = "collection" | "resolution";

export type SecurityDepositReceiptPdfProps = {
  receipt: SecurityDepositReceiptData;
  kind: SecurityDepositReceiptPdfKind;
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    color: "#111827",
    fontFamily: "Helvetica",
  },
  title: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#0f2744",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 10,
    color: "#475569",
    marginBottom: 18,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 8,
  },
  label: {
    width: "42%",
    color: "#64748b",
    fontSize: 9,
    textTransform: "uppercase",
  },
  value: {
    width: "56%",
    textAlign: "right",
    fontSize: 10,
  },
  amount: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#0f2744",
  },
  footer: {
    marginTop: 24,
    fontSize: 9,
    color: "#64748b",
  },
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export default function SecurityDepositReceiptPdfDocument({
  receipt,
  kind,
}: SecurityDepositReceiptPdfProps) {
  const title =
    kind === "collection"
      ? "Security deposit collection receipt"
      : "Security deposit resolution receipt";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>Issued by {receipt.landlordName}</Text>

        <DetailRow label="Tenant" value={receipt.lesseeName} />
        <DetailRow label="Property / unit" value={receipt.unitLabel} />

        {kind === "collection" ? (
          <>
            <DetailRow label="Landlord" value={receipt.landlordName} />
            <DetailRow
              label="Lease period"
              value={`${formatDate(receipt.leaseStartDate)} – ${formatDate(receipt.leaseEndDate)}`}
            />
            <View style={styles.row}>
              <Text style={styles.label}>Deposit amount</Text>
              <Text style={[styles.value, styles.amount]}>
                {formatMoney(receipt.amountGhs)}
              </Text>
            </View>
            <DetailRow label="Date collected" value={formatDate(receipt.dateCollected)} />
            <DetailRow label="Receipt / reference no." value={receipt.receiptReference} />
            <DetailRow label="Current status" value={receipt.statusLabel} />
          </>
        ) : (
          <>
            <DetailRow label="Original deposit" value={formatMoney(receipt.amountGhs)} />
            <DetailRow
              label="Resolution status"
              value={formatDepositStatus(receipt.status)}
            />
            <View style={styles.row}>
              <Text style={styles.label}>Amount returned</Text>
              <Text style={[styles.value, styles.amount]}>
                {formatMoney(receipt.amountReturnedGhs)}
              </Text>
            </View>
            <DetailRow label="Date resolved" value={formatDate(receipt.dateResolved)} />
            <DetailRow
              label="Resolution notes"
              value={receipt.resolutionNotes?.trim() || "—"}
            />
            <DetailRow
              label="Receipt / reference no."
              value={`${receipt.receiptReference}-resolution`}
            />
          </>
        )}

        <Text style={styles.footer}>
          Generated from Davors Facilities. Keep this document for your records.
        </Text>
      </Page>
    </Document>
  );
}
