import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import {
  CLIENT_INVOICE_COLORS,
  CLIENT_RECEIPT_PRINT_AREA_ID,
  formatInvoiceDate,
  formatReceiptMoney,
  hasReceiptAuthorizedBy,
  resolveInvoiceCompanyName,
  tenantHeaderContactLines,
  type ClientReceiptDisplayProps,
} from "./client-receipt-display-utils";

const C = CLIENT_INVOICE_COLORS;

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    color: C.textDark,
    fontFamily: "Helvetica",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: C.navy,
    padding: 16,
    marginBottom: 20,
    borderRadius: 4,
  },
  companyBlock: {
    flexDirection: "row",
    gap: 12,
    maxWidth: "58%",
  },
  logo: {
    width: 56,
    height: 56,
    objectFit: "cover",
    borderRadius: 4,
  },
  companyName: {
    fontSize: 14,
    fontWeight: "bold",
    color: C.white,
    marginBottom: 4,
  },
  companyMeta: {
    fontSize: 9,
    color: C.textOnNavy,
    marginBottom: 2,
  },
  metaBox: {
    backgroundColor: C.tealLight,
    borderWidth: 2,
    borderColor: C.navy,
    borderRadius: 4,
    padding: 12,
    alignItems: "flex-end",
    maxWidth: "38%",
  },
  receiptTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: C.gold,
    marginBottom: 8,
  },
  metaLine: {
    fontSize: 10,
    marginBottom: 3,
  },
  sectionBox: {
    borderWidth: 1,
    borderColor: C.navy,
    borderRadius: 4,
    marginBottom: 16,
    overflow: "hidden",
  },
  sectionBar: {
    backgroundColor: C.navy,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  sectionBarText: {
    color: C.white,
    fontSize: 10,
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  sectionBody: {
    padding: 12,
    backgroundColor: C.tealLight,
  },
  amountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: C.navy,
    padding: 12,
    borderRadius: 4,
    marginTop: 8,
  },
  amountLabel: {
    color: C.white,
    fontWeight: "bold",
  },
  amountValue: {
    color: C.gold,
    fontSize: 14,
    fontWeight: "bold",
  },
  signatureBlock: {
    marginTop: 24,
  },
  signatureLabel: {
    fontSize: 9,
    color: C.textMuted,
    marginBottom: 4,
  },
  signatureImage: {
    width: 140,
    height: 48,
    objectFit: "contain",
    marginBottom: 6,
  },
  signatureName: {
    fontSize: 11,
    fontWeight: "bold",
    color: C.navy,
  },
  signatureTitle: {
    fontSize: 10,
    color: C.textDark,
    marginTop: 2,
  },
  signatureLine: {
    marginTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.navy,
    width: 180,
  },
});

type ClientReceiptPdfDocumentProps = ClientReceiptDisplayProps & {
  logoUrl: string;
  signatureImageUrl?: string | null;
};

export default function ClientReceiptPdfDocument({
  receipt,
  invoice,
  branding,
  billingSettings,
  logoUrl,
  signatureImageUrl,
}: ClientReceiptPdfDocumentProps) {
  const companyName = resolveInvoiceCompanyName(branding, billingSettings);
  const contactLines = tenantHeaderContactLines(branding, billingSettings);

  return (
    <Document title={receipt.receipt_number}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.companyBlock}>
            {logoUrl ? <Image src={logoUrl} style={styles.logo} /> : null}
            <View>
              <Text style={styles.companyName}>{companyName}</Text>
              {contactLines.map((line, index) => (
                <Text key={`contact-${index}`} style={styles.companyMeta}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.receiptTitle}>RECEIPT</Text>
            <Text style={styles.metaLine}>
              <Text style={{ fontWeight: "bold" }}>Receipt #: </Text>
              {receipt.receipt_number}
            </Text>
            <Text style={styles.metaLine}>
              <Text style={{ fontWeight: "bold" }}>Date: </Text>
              {formatInvoiceDate(receipt.receipt_date)}
            </Text>
            <Text style={styles.metaLine}>
              <Text style={{ fontWeight: "bold" }}>Invoice #: </Text>
              {invoice.invoice_number}
            </Text>
          </View>
        </View>

        <View style={styles.sectionBox}>
          <View style={styles.sectionBar}>
            <Text style={styles.sectionBarText}>Received From</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text>{invoice.bill_to_name}</Text>
            {invoice.bill_to_address?.trim() ? (
              <Text>{invoice.bill_to_address.trim()}</Text>
            ) : null}
            {invoice.bill_to_phone?.trim() ? (
              <Text>{invoice.bill_to_phone.trim()}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.sectionBox}>
          <View style={styles.sectionBar}>
            <Text style={styles.sectionBarText}>Payment Details</Text>
          </View>
          <View style={styles.sectionBody}>
            {receipt.payment_method?.trim() ? (
              <Text>Method: {receipt.payment_method.trim()}</Text>
            ) : null}
            {receipt.notes?.trim() ? (
              <Text style={{ marginTop: 4 }}>Notes: {receipt.notes.trim()}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.amountRow}>
          <Text style={styles.amountLabel}>Amount Received</Text>
          <Text style={styles.amountValue}>{formatReceiptMoney(receipt.amount)}</Text>
        </View>

        {hasReceiptAuthorizedBy(receipt) ? (
          <View style={styles.signatureBlock}>
            <Text style={styles.signatureLabel}>Authorized By:</Text>
            {signatureImageUrl ? (
              <Image src={signatureImageUrl} style={styles.signatureImage} />
            ) : (
              <View style={styles.signatureLine} />
            )}
            <Text style={styles.signatureName}>{receipt.authorized_by_name?.trim()}</Text>
            {receipt.authorized_by_title?.trim() ? (
              <Text style={styles.signatureTitle}>{receipt.authorized_by_title.trim()}</Text>
            ) : null}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

export { CLIENT_RECEIPT_PRINT_AREA_ID };
