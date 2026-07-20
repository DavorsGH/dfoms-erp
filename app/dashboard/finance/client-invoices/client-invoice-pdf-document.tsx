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
  CLIENT_INVOICE_LABOUR_TAX_NOTE,
  CLIENT_INVOICE_PAYMENT_FOOTER,
  buildClientInvoiceGroups,
  formatBillingPeriodLabel,
  formatInvoiceDate,
  formatInvoiceMoney,
  paymentAccountDetailLines,
  resolveInvoiceCompanyName,
  sumLineItemColumns,
  tenantHeaderContactLines,
  type ClientInvoiceDisplayProps,
} from "./client-invoice-display-utils";

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
  invoiceTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: C.gold,
    marginBottom: 8,
  },
  metaLine: {
    fontSize: 10,
    marginBottom: 3,
    color: C.textDark,
  },
  metaLabel: {
    fontWeight: "bold",
    color: C.navy,
  },
  metaValue: {
    color: C.textDark,
  },
  section: {
    marginBottom: 18,
  },
  sectionBox: {
    borderWidth: 1,
    borderColor: C.navy,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 18,
  },
  sectionBar: {
    backgroundColor: C.navy,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  sectionBarText: {
    fontSize: 11,
    fontWeight: "bold",
    color: C.white,
    textTransform: "uppercase",
  },
  sectionBody: {
    backgroundColor: C.tealLight,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: `${C.navy}33`,
  },
  billToText: {
    fontSize: 10,
    marginBottom: 3,
    color: C.textDark,
  },
  categoryHeaderRow: {
    width: "100%",
    backgroundColor: C.tealBand,
    borderBottomWidth: 1,
    borderBottomColor: "#b8dce3",
    padding: 6,
  },
  categoryHeaderText: {
    fontSize: 10,
    fontWeight: "bold",
    color: C.navy,
  },
  table: {
    borderWidth: 1,
    borderColor: `${C.navy}40`,
    marginBottom: 8,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: C.navy,
    borderBottomWidth: 1,
    borderBottomColor: C.navy,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  tableRowEven: {
    backgroundColor: C.cream,
  },
  tableRowOdd: {
    backgroundColor: C.white,
  },
  cellDescription: {
    width: "40%",
    padding: 6,
    color: C.textDark,
  },
  cellAmount: {
    width: "15%",
    padding: 6,
    textAlign: "right",
    color: C.textDark,
  },
  cellAmountAccent: {
    width: "15%",
    padding: 6,
    textAlign: "right",
    color: C.navy,
    fontWeight: "bold",
  },
  headerText: {
    fontWeight: "bold",
    fontSize: 9,
    color: C.white,
  },
  tableFooterRow: {
    backgroundColor: C.navyBand,
    borderTopWidth: 2,
    borderTopColor: `${C.navy}4D`,
  },
  footerText: {
    fontWeight: "bold",
    color: C.navy,
  },
  totalsBlock: {
    marginTop: 8,
    marginLeft: "auto",
    width: "52%",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  totalLabel: {
    fontSize: 10,
    color: C.textMuted,
  },
  totalValue: {
    fontSize: 10,
    fontWeight: "bold",
    color: C.navy,
  },
  totalDueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: C.navy,
    padding: 8,
    marginTop: 4,
    borderRadius: 4,
  },
  totalDueLabel: {
    fontSize: 11,
    fontWeight: "bold",
    color: C.white,
  },
  totalDueValue: {
    fontSize: 11,
    fontWeight: "bold",
    color: C.gold,
  },
  totalNote: {
    fontSize: 8,
    color: C.textMuted,
    marginTop: 2,
  },
  paymentAccount: {
    borderWidth: 1,
    borderColor: `${C.navy}33`,
    backgroundColor: C.white,
    padding: 8,
    marginBottom: 8,
    borderRadius: 4,
  },
  paymentLine: {
    fontSize: 9,
    marginBottom: 2,
    color: C.textDark,
  },
  paymentLabel: {
    fontWeight: "bold",
    color: "#334155",
  },
  footer: {
    marginTop: 24,
    padding: 12,
    borderWidth: 2,
    borderColor: `${C.navy}40`,
    backgroundColor: C.tealLight,
    borderRadius: 4,
    fontSize: 9,
    color: C.textDark,
  },
  notes: {
    fontSize: 9,
    color: C.textDark,
  },
});

type ClientInvoicePdfDocumentProps = ClientInvoiceDisplayProps & {
  logoUrl: string;
};

export default function ClientInvoicePdfDocument({
  invoice,
  lineItems,
  paymentAccounts,
  branding,
  billingSettings,
  logoUrl,
}: ClientInvoicePdfDocumentProps) {
  const groupedLines = buildClientInvoiceGroups(lineItems);
  const lineColumnTotals = sumLineItemColumns(lineItems);
  const companyName = resolveInvoiceCompanyName(branding, billingSettings);
  const companyContactLines = tenantHeaderContactLines(branding, billingSettings);
  const billingPeriod = formatBillingPeriodLabel(
    invoice.billing_period_start,
    invoice.billing_period_end,
  );

  let lineRowIndex = 0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.companyBlock}>
            {logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- PDF Image has no alt prop
              <Image src={logoUrl} style={styles.logo} />
            ) : null}
            <View>
              <Text style={styles.companyName}>{companyName}</Text>
              {companyContactLines.map((line, index) => (
                <Text key={`contact-${index}`} style={styles.companyMeta}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.metaLine}>
              <Text style={styles.metaLabel}>Invoice #: </Text>
              <Text style={styles.metaValue}>{invoice.invoice_number}</Text>
            </Text>
            <Text style={styles.metaLine}>
              <Text style={styles.metaLabel}>Date: </Text>
              <Text style={styles.metaValue}>{formatInvoiceDate(invoice.invoice_date)}</Text>
            </Text>
            <Text style={styles.metaLine}>
              <Text style={styles.metaLabel}>Due Date: </Text>
              <Text style={styles.metaValue}>{formatInvoiceDate(invoice.due_date)}</Text>
            </Text>
          </View>
        </View>

        <View style={styles.sectionBox}>
          <View style={styles.sectionBar}>
            <Text style={styles.sectionBarText}>Bill To</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.billToText}>{invoice.bill_to_name}</Text>
            {invoice.bill_to_address?.trim() ? (
              <Text style={styles.billToText}>{invoice.bill_to_address.trim()}</Text>
            ) : null}
            {invoice.bill_to_phone?.trim() ? (
              <Text style={styles.billToText}>{invoice.bill_to_phone.trim()}</Text>
            ) : null}
            {billingPeriod ? (
              <Text style={[styles.billToText, { marginTop: 6 }]}>
                Billing period: {billingPeriod}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <View style={[styles.sectionBar, { borderTopLeftRadius: 4, borderTopRightRadius: 4 }]}>
            <Text style={styles.sectionBarText}>Line Items</Text>
          </View>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.cellDescription, styles.headerText]}>
                Description
              </Text>
              <Text style={[styles.cellAmount, styles.headerText]}>Service</Text>
              <Text style={[styles.cellAmount, styles.headerText]}>Material</Text>
              <Text style={[styles.cellAmount, styles.headerText]}>Discount</Text>
              <Text style={[styles.cellAmount, styles.headerText]}>Total Cost</Text>
            </View>
            {groupedLines.flatMap((group) => [
              <View key={`category-${group.label}`} style={styles.categoryHeaderRow}>
                <Text style={styles.categoryHeaderText}>{group.label}</Text>
              </View>,
              ...group.items.map((line) => {
                const rowStyle =
                  lineRowIndex % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd;
                lineRowIndex += 1;

                return (
                  <View key={line.id} style={[styles.tableRow, rowStyle]}>
                    <Text style={styles.cellDescription}>{line.description}</Text>
                    <Text style={styles.cellAmount}>
                      {formatInvoiceMoney(line.labour_amount)}
                    </Text>
                    <Text style={styles.cellAmount}>
                      {formatInvoiceMoney(line.material_amount)}
                    </Text>
                    <Text style={styles.cellAmount}>
                      {formatInvoiceMoney(line.discount_amount)}
                    </Text>
                    <Text style={styles.cellAmountAccent}>
                      {formatInvoiceMoney(line.total_cost)}
                    </Text>
                  </View>
                );
              }),
            ])}
            <View style={[styles.tableRow, styles.tableFooterRow]}>
              <Text style={[styles.cellDescription, styles.footerText]}>Subtotal</Text>
              <Text style={[styles.cellAmount, styles.footerText]}>
                {formatInvoiceMoney(lineColumnTotals.labour)}
              </Text>
              <Text style={[styles.cellAmount, styles.footerText]}>
                {formatInvoiceMoney(lineColumnTotals.material)}
              </Text>
              <Text style={[styles.cellAmount, styles.footerText]}>
                {formatInvoiceMoney(lineColumnTotals.discount)}
              </Text>
              <Text style={[styles.cellAmount, styles.footerText]}>
                {formatInvoiceMoney(lineColumnTotals.total_cost)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatInvoiceMoney(invoice.subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <View>
              <Text style={styles.totalLabel}>
                VAT/NHIL/GETFund ({invoice.vat_nhil_getfund_rate}%)
              </Text>
              <Text style={styles.totalNote}>{CLIENT_INVOICE_LABOUR_TAX_NOTE}</Text>
            </View>
            <Text style={styles.totalValue}>{formatInvoiceMoney(invoice.tax_due)}</Text>
          </View>
          <View style={styles.totalRow}>
            <View>
              <Text style={styles.totalLabel}>
                WHT ({invoice.wht_rate}%)
              </Text>
              <Text style={styles.totalNote}>{CLIENT_INVOICE_LABOUR_TAX_NOTE}</Text>
              <Text style={styles.totalNote}>
                For your records — not deducted from total
              </Text>
            </View>
            <Text style={styles.totalValue}>{formatInvoiceMoney(invoice.wht_amount)}</Text>
          </View>
          <View style={styles.totalDueRow}>
            <Text style={styles.totalDueLabel}>Total Amount Due</Text>
            <Text style={styles.totalDueValue}>
              {formatInvoiceMoney(invoice.total_amount_due)}
            </Text>
          </View>
        </View>

        {paymentAccounts.length > 0 ? (
          <View style={[styles.sectionBox, { marginTop: 18 }]}>
            <View style={styles.sectionBar}>
              <Text style={styles.sectionBarText}>Payment Details</Text>
            </View>
            <View style={styles.sectionBody}>
              {paymentAccounts.map((account) => {
                const details = paymentAccountDetailLines(account);
                if (details.length === 0) {
                  return null;
                }

                return (
                  <View key={account.id} style={styles.paymentAccount}>
                    {details.map((detail) => (
                      <Text key={`${account.id}-${detail.label}`} style={styles.paymentLine}>
                        <Text style={styles.paymentLabel}>{detail.label}: </Text>
                        {detail.value}
                      </Text>
                    ))}
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {invoice.notes?.trim() ? (
          <View style={styles.sectionBox}>
            <View style={styles.sectionBar}>
              <Text style={styles.sectionBarText}>Notes</Text>
            </View>
            <View style={styles.sectionBody}>
              <Text style={styles.notes}>{invoice.notes.trim()}</Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.footer}>{CLIENT_INVOICE_PAYMENT_FOOTER}</Text>
      </Page>
    </Document>
  );
}
