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
  buildClientQuotationGroups,
  formatInvoiceDate,
  formatInvoiceMoney,
  hasAuthorizedBySignature,
  resolveAuthorizedByDisplayTitle,
  paymentAccountDetailLines,
  quotationPrintTitle,
  quotationNumberMetaLabel,
  quotationTaxBasisNote,
  quotationValidityAndPaymentFooter,
  quotationPortalValidityAndPaymentFooter,
  resolveInvoiceCompanyName,
  sumQuotationLineItemColumns,
  tenantHeaderContactLines,
  type ClientQuotationDisplayProps,
} from "./client-quotation-display-utils";
import {
  normalizeQuotationDiscountType,
  quotationHasDistinctShipTo,
  quotationHeaderDiscountLabel,
  resolvePortalQuotationExpiryDisplay,
  resolveQuotationOpportunityName,
} from "@/utils/client-quotations-types";

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
    alignItems: "flex-start",
    flex: 1,
    maxWidth: "60%",
    minWidth: 0,
  },
  logo: {
    width: 56,
    height: 56,
    objectFit: "cover",
    borderRadius: 4,
    marginRight: 12,
    flexShrink: 0,
  },
  companyTextBlock: {
    flex: 1,
    minWidth: 0,
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
    flexShrink: 0,
    maxWidth: "38%",
    marginLeft: 12,
  },
  documentTitle: {
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
  addressColumns: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  addressColumn: {
    flex: 1,
    marginBottom: 0,
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
    width: "32%",
    padding: 6,
    color: C.textDark,
  },
  cellAmount: {
    width: "17%",
    padding: 6,
    textAlign: "right",
    color: C.textDark,
  },
  cellAmountAccent: {
    width: "17%",
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
  footerAmount: {
    fontWeight: "bold",
    color: C.navy,
    fontSize: 9,
    padding: 3,
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
  documentClosingBlock: {
    marginTop: 24,
  },
  footerBox: {
    padding: 12,
    borderWidth: 2,
    borderColor: `${C.navy}40`,
    backgroundColor: C.tealLight,
    borderRadius: 4,
  },
  footerNoticeText: {
    fontSize: 9,
    color: C.textDark,
  },
  signatureBlock: {
    marginTop: 16,
    alignSelf: "flex-start",
  },
  signatureLabel: {
    fontSize: 8,
    fontWeight: "bold",
    color: C.textMuted,
  },
  signatureName: {
    fontSize: 10,
    fontWeight: "bold",
    color: C.navy,
    marginTop: 4,
  },
  signatureTitleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    flexWrap: "wrap",
    marginTop: 6,
  },
  signatureTitle: {
    fontSize: 9,
    color: C.textMuted,
  },
  signatureTitleSpacer: {
    width: 12,
  },
  signaturePromptGroup: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  signaturePrompt: {
    fontSize: 9,
    color: C.textMuted,
  },
  signatureLine: {
    width: 120,
    borderBottomWidth: 2,
    borderBottomColor: C.navy,
  },
  signatureImage: {
    width: 140,
    height: 48,
    objectFit: "contain",
    marginBottom: 6,
  },
  notes: {
    fontSize: 9,
    color: C.textDark,
  },
});

type ClientQuotationPdfDocumentProps = ClientQuotationDisplayProps & {
  logoUrl: string;
  signatureImageUrl?: string | null;
  portalQuotationDates?: boolean;
};

export default function ClientQuotationPdfDocument({
  quotation,
  lineItems,
  paymentAccounts,
  branding,
  billingSettings,
  graTin,
  businessUnitContact = null,
  logoUrl,
  signatureImageUrl,
  portalQuotationDates = false,
}: ClientQuotationPdfDocumentProps) {
  const groupedLines = buildClientQuotationGroups(lineItems);
  const lineColumnTotals = sumQuotationLineItemColumns(lineItems);
  const companyName = resolveInvoiceCompanyName(
    branding,
    billingSettings,
    businessUnitContact,
  );
  const companyContactLines = tenantHeaderContactLines(
    branding,
    billingSettings,
    graTin,
    businessUnitContact,
  );
  const printTitle = quotationPrintTitle(quotation.document_type);
  const numberMetaLabel = quotationNumberMetaLabel(quotation.document_type);
  const opportunityName = resolveQuotationOpportunityName(quotation);
  const taxBasisNote = quotationTaxBasisNote(quotation);
  const authorizedByTitle = resolveAuthorizedByDisplayTitle(
    quotation.authorized_by_title,
    branding,
  );
  const headerDiscountLabel = quotationHeaderDiscountLabel(quotation);
  const isPercentageDiscount =
    normalizeQuotationDiscountType(quotation.discount_type) === "percentage";
  const showDistinctShipTo = quotationHasDistinctShipTo(quotation);
  const expiryDisplay = portalQuotationDates
    ? resolvePortalQuotationExpiryDisplay(quotation)
    : null;

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
            <View style={styles.companyTextBlock}>
              <Text style={styles.companyName}>{companyName}</Text>
              {companyContactLines.map((line, index) => (
                <Text key={`contact-${index}`} style={styles.companyMeta}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.documentTitle}>{printTitle}</Text>
            <Text style={styles.metaLine}>
              <Text style={styles.metaLabel}>{numberMetaLabel}</Text>
              <Text style={styles.metaValue}>{quotation.quotation_number}</Text>
            </Text>
            <Text style={styles.metaLine}>
              <Text style={styles.metaLabel}>Date: </Text>
              <Text style={styles.metaValue}>{formatInvoiceDate(quotation.issue_date)}</Text>
            </Text>
            <Text style={styles.metaLine}>
              <Text style={styles.metaLabel}>
                {portalQuotationDates && expiryDisplay
                  ? expiryDisplay.metaLabel
                  : "Valid Until: "}
              </Text>
              <Text style={styles.metaValue}>
                {portalQuotationDates && expiryDisplay
                  ? (expiryDisplay.metaValue ?? "—")
                  : formatInvoiceDate(quotation.valid_until)}
              </Text>
            </Text>
            {opportunityName ? (
              <Text style={styles.metaLine}>
                <Text style={styles.metaLabel}>Opportunity: </Text>
                <Text style={styles.metaValue}>{opportunityName}</Text>
              </Text>
            ) : null}
          </View>
        </View>

        {showDistinctShipTo ? (
          <View style={styles.addressColumns}>
            <View style={[styles.sectionBox, styles.addressColumn]}>
              <View style={styles.sectionBar}>
                <Text style={styles.sectionBarText}>Bill To</Text>
              </View>
              <View style={styles.sectionBody}>
                <Text style={styles.billToText}>{quotation.bill_to_name}</Text>
                {quotation.bill_to_address?.trim() ? (
                  <Text style={styles.billToText}>{quotation.bill_to_address.trim()}</Text>
                ) : null}
                {quotation.bill_to_phone?.trim() ? (
                  <Text style={styles.billToText}>{quotation.bill_to_phone.trim()}</Text>
                ) : null}
              </View>
            </View>

            <View style={[styles.sectionBox, styles.addressColumn]}>
              <View style={styles.sectionBar}>
                <Text style={styles.sectionBarText}>Ship To</Text>
              </View>
              <View style={styles.sectionBody}>
                {quotation.ship_to_name?.trim() ? (
                  <Text style={styles.billToText}>{quotation.ship_to_name.trim()}</Text>
                ) : null}
                {quotation.ship_to_address?.trim() ? (
                  <Text style={styles.billToText}>{quotation.ship_to_address.trim()}</Text>
                ) : null}
                {quotation.ship_to_phone?.trim() ? (
                  <Text style={styles.billToText}>{quotation.ship_to_phone.trim()}</Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.sectionBox}>
            <View style={styles.sectionBar}>
              <Text style={styles.sectionBarText}>Bill To</Text>
            </View>
            <View style={styles.sectionBody}>
              <Text style={styles.billToText}>{quotation.bill_to_name}</Text>
              {quotation.bill_to_address?.trim() ? (
                <Text style={styles.billToText}>{quotation.bill_to_address.trim()}</Text>
              ) : null}
              {quotation.bill_to_phone?.trim() ? (
                <Text style={styles.billToText}>{quotation.bill_to_phone.trim()}</Text>
              ) : null}
            </View>
          </View>
        )}

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
              <Text style={[styles.cellAmount, styles.footerAmount]}>
                {formatInvoiceMoney(lineColumnTotals.labour)}
              </Text>
              <Text style={[styles.cellAmount, styles.footerAmount]}>
                {formatInvoiceMoney(lineColumnTotals.material)}
              </Text>
              <Text style={[styles.cellAmount, styles.footerAmount]}>
                {formatInvoiceMoney(lineColumnTotals.discount)}
              </Text>
              <Text style={[styles.cellAmount, styles.footerAmount]}>
                {formatInvoiceMoney(lineColumnTotals.total_cost)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.totalsBlock}>
          {headerDiscountLabel ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Line Subtotal</Text>
              <Text style={styles.totalValue}>
                {formatInvoiceMoney(
                  quotation.subtotal + quotation.header_discount_amount,
                )}
              </Text>
            </View>
          ) : null}
          {headerDiscountLabel ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{headerDiscountLabel}</Text>
              {isPercentageDiscount ? (
                <Text style={styles.totalValue}>
                  -{formatInvoiceMoney(quotation.header_discount_amount)}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatInvoiceMoney(quotation.subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <View>
              <Text style={styles.totalLabel}>
                VAT/NHIL/GETFund ({quotation.vat_nhil_getfund_rate}%)
              </Text>
              <Text style={styles.totalNote}>{taxBasisNote}</Text>
            </View>
            <Text style={styles.totalValue}>{formatInvoiceMoney(quotation.tax_due)}</Text>
          </View>
          <View style={styles.totalRow}>
            <View>
              <Text style={styles.totalLabel}>WHT ({quotation.wht_rate}%)</Text>
              <Text style={styles.totalNote}>{taxBasisNote}</Text>
              <Text style={styles.totalNote}>
                For your records — not deducted from total
              </Text>
            </View>
            <Text style={styles.totalValue}>{formatInvoiceMoney(quotation.wht_amount)}</Text>
          </View>
          <View style={styles.totalDueRow}>
            <Text style={styles.totalDueLabel}>Total Amount Due</Text>
            <Text style={styles.totalDueValue}>
              {formatInvoiceMoney(quotation.total_amount_due)}
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

        {quotation.notes?.trim() ? (
          <View style={styles.sectionBox}>
            <View style={styles.sectionBar}>
              <Text style={styles.sectionBarText}>Notes</Text>
            </View>
            <View style={styles.sectionBody}>
              <Text style={styles.notes}>{quotation.notes.trim()}</Text>
            </View>
          </View>
        ) : null}

        <View wrap={false} style={styles.documentClosingBlock}>
          <Text style={[styles.footerBox, styles.footerNoticeText]} wrap={false}>
            {portalQuotationDates
              ? quotationPortalValidityAndPaymentFooter(
                  quotation,
                  quotation.payment_terms,
                )
              : quotationValidityAndPaymentFooter(
                  quotation.valid_until,
                  quotation.payment_terms,
                )}
          </Text>

          {hasAuthorizedBySignature(quotation) ? (
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLabel}>Authorized By:</Text>
              {signatureImageUrl ? (
                <Image src={signatureImageUrl} style={styles.signatureImage} />
              ) : null}
              <Text style={styles.signatureName}>
                {quotation.authorized_by_name?.trim()}
              </Text>
              <View style={styles.signatureTitleRow}>
                {authorizedByTitle ? (
                  <>
                    <Text style={styles.signatureTitle}>{authorizedByTitle},</Text>
                    <View style={styles.signatureTitleSpacer} />
                  </>
                ) : null}
                {!signatureImageUrl ? (
                  <View style={styles.signaturePromptGroup}>
                    <Text style={styles.signaturePrompt}>Signature:</Text>
                    <View style={styles.signatureLine} />
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>

        {quotation.commercial_terms?.trim() ? (
          <View style={[styles.sectionBox, { marginTop: 18 }]}>
            <View style={styles.sectionBar}>
              <Text style={styles.sectionBarText}>Commercial Terms</Text>
            </View>
            <View style={styles.sectionBody}>
              <Text style={styles.notes}>{quotation.commercial_terms.trim()}</Text>
            </View>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
