import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { RentPaymentReceiptData } from "@/utils/rent-payment-receipt";

export type RentPaymentReceiptPdfProps = {
  receipt: RentPaymentReceiptData;
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

function formatMoney(value: number): string {
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

export default function RentPaymentReceiptPdfDocument({
  receipt,
}: RentPaymentReceiptPdfProps) {
  const periodLabel =
    receipt.chargeType === "one_time"
      ? formatDate(receipt.periodStart)
      : `${formatDate(receipt.periodStart)} – ${formatDate(receipt.periodEnd)}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{receipt.documentTitle}</Text>
        <Text style={styles.subtitle}>Issued by {receipt.landlordName}</Text>

        <DetailRow label="Tenant" value={receipt.lesseeName} />
        <DetailRow label="Property / unit" value={receipt.unitLabel} />
        <DetailRow label="Charge type" value={receipt.chargeTypeLabel} />
        <DetailRow
          label={receipt.chargeType === "one_time" ? "Charge date" : "Billing period"}
          value={periodLabel}
        />
        <View style={styles.row}>
          <Text style={styles.label}>Amount paid</Text>
          <Text style={[styles.value, styles.amount]}>
            {formatMoney(receipt.amountPaidGhs)}
          </Text>
        </View>
        <DetailRow label="Payment method" value={receipt.paymentMethodLabel} />
        <DetailRow label="Payment date" value={formatDate(receipt.paymentDate)} />
        <DetailRow label="Receipt / reference no." value={receipt.receiptReference} />
        <DetailRow label="Status" value={receipt.statusLabel} />
        <DetailRow label="Amount due" value={formatMoney(receipt.amountDueGhs)} />
        <DetailRow label="Outstanding" value={formatMoney(receipt.outstandingGhs)} />
        {receipt.notes ? (
          <DetailRow label="Notes" value={receipt.notes} />
        ) : null}

        <Text style={styles.footer}>
          Generated from Davors Facilities. Keep this receipt for your records.
        </Text>
      </Page>
    </Document>
  );
}
