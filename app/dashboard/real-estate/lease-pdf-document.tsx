import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

export type LeasePdfDocumentProps = {
  landlordName: string;
  lesseeName: string;
  lesseePhone: string;
  lesseeEmail: string | null;
  propertyName: string;
  unitNumber: string;
  startDate: string;
  endDate: string;
  rentAmountGhs: number;
  depositAmountGhs: number | null;
  lateFeeEnabled: boolean;
  lateFeeType: "fixed" | "percent" | null;
  lateFeeAmount: number | null;
  escalationPercent: number | null;
  escalationFrequencyMonths: number | null;
  disclaimer: string;
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    color: "#0f172a",
    fontFamily: "Helvetica",
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0f2744",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 10,
    color: "#475569",
    marginBottom: 20,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#0f2744",
    textTransform: "uppercase",
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
  },
  row: {
    flexDirection: "row",
    marginBottom: 4,
  },
  label: {
    width: "38%",
    color: "#64748b",
  },
  value: {
    width: "62%",
    color: "#0f172a",
  },
  disclaimer: {
    marginTop: 24,
    padding: 10,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    fontSize: 9,
    color: "#475569",
    lineHeight: 1.4,
  },
});

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "—";
  }
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export default function LeasePdfDocument(props: LeasePdfDocumentProps) {
  const lateFeeLabel = !props.lateFeeEnabled
    ? "Disabled"
    : props.lateFeeType === "percent"
      ? `${props.lateFeeAmount ?? 0}%`
      : formatMoney(props.lateFeeAmount);

  const escalationLabel =
    props.escalationPercent == null
      ? "None"
      : `${props.escalationPercent}% every ${props.escalationFrequencyMonths ?? "—"} months`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Lease summary</Text>
        <Text style={styles.subtitle}>
          Generated on demand for review and acknowledgment. Not a legal
          electronic signature instrument.
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Parties</Text>
          <DetailRow label="Landlord" value={props.landlordName || "—"} />
          <DetailRow label="Tenant / lessee" value={props.lesseeName || "—"} />
          <DetailRow label="Phone" value={props.lesseePhone || "—"} />
          <DetailRow label="Email" value={props.lesseeEmail?.trim() || "—"} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Property and unit</Text>
          <DetailRow label="Property" value={props.propertyName || "—"} />
          <DetailRow label="Unit" value={props.unitNumber || "—"} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Terms</Text>
          <DetailRow label="Start date" value={formatDate(props.startDate)} />
          <DetailRow label="End date" value={formatDate(props.endDate)} />
          <DetailRow
            label="Monthly rent"
            value={formatMoney(props.rentAmountGhs)}
          />
          <DetailRow
            label="Security deposit"
            value={formatMoney(props.depositAmountGhs)}
          />
          <DetailRow label="Late fee" value={lateFeeLabel} />
          <DetailRow label="Escalation" value={escalationLabel} />
        </View>

        <Text style={styles.disclaimer}>{props.disclaimer}</Text>
      </Page>
    </Document>
  );
}
