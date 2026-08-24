import {
  computeQuotationTotals,
  formatInvoiceDate,
  formatInvoiceMoney,
  groupLineItemsByCategory,
  mapQuotationLineForDisplay,
  normalizeQuotationDiscountType,
  normalizeQuotationType,
  quotationHeaderDiscountLabel,
  quotationPaymentTermsLabel,
  quotationPrintTitle,
  quotationNumberMetaLabel,
  resolveQuotationTaxBasis,
  resolveConvertedInvoiceLink,
  roundMoney,
  toNumber,
  type ClientQuotationHeaderRow,
  type ClientQuotationLineItemInput,
  type ClientQuotationLineItemRow,
  type ClientQuotationWriteBody,
} from "@/utils/client-quotations-types";
import type { BillingSettingsHeaderFields } from "@/utils/billing-settings-types";
import type { PaymentAccountRow } from "@/utils/payment-accounts-types";
import type { TenantBranding } from "@/utils/tenant-branding-types";
import {
  CLIENT_INVOICE_COLORS,
  CLIENT_INVOICE_LABOUR_TAX_NOTE,
  CLIENT_INVOICE_TOTAL_COST_TAX_NOTE,
  clientInvoiceTaxBasisNote,
  hasAuthorizedBySignature,
  resolveAuthorizedByDisplayTitle,
  paymentAccountDetailLines,
  resolveBrandingLogoUrl,
  resolveInvoiceCompanyName,
  tenantHeaderContactLines,
} from "@/app/dashboard/finance/client-invoices/client-invoice-display-utils";

export const CLIENT_QUOTATION_PRINT_AREA_ID = "client-quotation-print-area";

export type ClientQuotationDetailPayload = {
  client_quotation: ClientQuotationHeaderRow;
  line_items: ClientQuotationLineItemRow[];
  payment_account_ids: string[];
  payment_accounts: PaymentAccountRow[];
};

export type ClientQuotationDisplayProps = {
  quotation: ClientQuotationHeaderRow;
  lineItems: ClientQuotationLineItemRow[];
  paymentAccounts: PaymentAccountRow[];
  branding: TenantBranding;
  billingSettings: BillingSettingsHeaderFields | null;
};

export function normalizeClientQuotationDetail(
  payload: ClientQuotationDetailPayload,
): ClientQuotationDisplayProps {
  const quotation = payload.client_quotation;

  const quotationType = normalizeQuotationType(quotation.quotation_type);

  return {
    quotation: {
      ...quotation,
      quotation_type: quotationType,
      tax_basis: resolveQuotationTaxBasis(quotation.tax_basis, quotationType),
      subtotal: toNumber(quotation.subtotal),
      vat_nhil_getfund_rate: toNumber(quotation.vat_nhil_getfund_rate),
      tax_due: toNumber(quotation.tax_due),
      wht_rate: toNumber(quotation.wht_rate),
      wht_amount: toNumber(quotation.wht_amount),
      header_discount_amount: toNumber(quotation.header_discount_amount),
      discount_type: normalizeQuotationDiscountType(quotation.discount_type),
      discount_percentage:
        quotation.discount_percentage != null
          ? toNumber(quotation.discount_percentage)
          : null,
      total_amount_due: toNumber(quotation.total_amount_due),
      commercial_terms: quotation.commercial_terms ?? null,
      internal_notes: quotation.internal_notes ?? null,
      payment_terms: quotation.payment_terms ?? null,
      ship_to_name: quotation.ship_to_name ?? null,
      ship_to_address: quotation.ship_to_address ?? null,
      ship_to_phone: quotation.ship_to_phone ?? null,
      converted_invoice: Array.isArray(quotation.converted_invoice)
        ? (quotation.converted_invoice[0] ?? null)
        : (quotation.converted_invoice ?? null),
    },
    lineItems: [...payload.line_items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((line) =>
        mapQuotationLineForDisplay(
          {
            ...line,
            labour_amount: toNumber(line.labour_amount),
            material_amount: toNumber(line.material_amount),
            discount_amount: toNumber(line.discount_amount),
            total_cost: toNumber(line.total_cost),
            quantity: line.quantity != null ? toNumber(line.quantity) : null,
            unit_price: line.unit_price != null ? toNumber(line.unit_price) : null,
          },
          quotationType,
        ),
      ),
    paymentAccounts: payload.payment_accounts,
    branding: {
      workspaceName: "",
      workspaceLogoUrl: "",
      workspaceLogoReference: "",
      companyLegalName: "",
      address: null,
      phone: null,
      email: null,
      signatureImageUrl: null,
      signatureAuthorName: null,
      signatureAuthorTitle: null,
    },
    billingSettings: null,
  };
}

export function buildClientQuotationGroups(lineItems: ClientQuotationLineItemRow[]) {
  return groupLineItemsByCategory(lineItems);
}

export function sumQuotationLineItemColumns(lineItems: ClientQuotationLineItemRow[]) {
  const totals = lineItems.reduce(
    (acc, line) => ({
      labour: acc.labour + toNumber(line.labour_amount),
      material: acc.material + toNumber(line.material_amount),
      discount: acc.discount + toNumber(line.discount_amount),
      total_cost: acc.total_cost + toNumber(line.total_cost),
    }),
    { labour: 0, material: 0, discount: 0, total_cost: 0 },
  );

  return {
    labour: roundMoney(totals.labour),
    material: roundMoney(totals.material),
    discount: roundMoney(totals.discount),
    total_cost: roundMoney(totals.total_cost),
  };
}

export function quotationTaxBasisNote(
  quotation: Pick<ClientQuotationHeaderRow, "tax_basis" | "quotation_type">,
) {
  const taxBasis = resolveQuotationTaxBasis(
    quotation.tax_basis,
    normalizeQuotationType(quotation.quotation_type),
  );

  return taxBasis === "total_cost"
    ? CLIENT_INVOICE_TOTAL_COST_TAX_NOTE
    : CLIENT_INVOICE_LABOUR_TAX_NOTE;
}

export { quotationPrintTitle, quotationNumberMetaLabel, resolveConvertedInvoiceLink, quotationHeaderDiscountLabel };

export function quotationValidityFooter(validUntil: string | null | undefined) {
  if (!validUntil) {
    return "This document is subject to the validity period shown above.";
  }

  return `This document is valid until ${formatInvoiceDate(validUntil)} unless otherwise agreed in writing.`;
}

export function quotationValidityAndPaymentFooter(
  validUntil: string | null | undefined,
  paymentTerms: string | null | undefined,
) {
  const validity = quotationValidityFooter(validUntil);
  const terms = quotationPaymentTermsLabel(paymentTerms);
  return `${validity} Payment terms: ${terms}.`;
}

export function buildClientQuotationPreviewDisplay(input: {
  tenantId: string;
  quotationNumber: string;
  form: ClientQuotationWriteBody;
  paymentAccounts: PaymentAccountRow[];
  opportunityName?: string | null;
  authorizedBy: {
    authorized_by_name: string | null;
    authorized_by_title: string | null;
  };
  branding: TenantBranding;
  billingSettings: BillingSettingsHeaderFields | null;
}): ClientQuotationDisplayProps {
  const quotationType = normalizeQuotationType(input.form.quotation_type);
  const taxBasis = resolveQuotationTaxBasis(input.form.tax_basis, quotationType);
  const discountType =
    quotationType === "product"
      ? normalizeQuotationDiscountType(input.form.discount_type)
      : "flat";
  const totals = computeQuotationTotals(
    input.form.line_items,
    input.form.vat_nhil_getfund_rate ?? 0,
    input.form.wht_rate ?? 0,
    taxBasis,
    input.form.header_discount_amount ?? 0,
    quotationType,
    discountType,
    input.form.discount_percentage ?? 0,
  );

  const lineItems: ClientQuotationLineItemRow[] = totals.line_items.map(
    (line, index) =>
      mapQuotationLineForDisplay(
        {
          id: `preview-line-${index}`,
          quotation_id: "preview",
          tenant_id: input.tenantId,
          site_id: line.site_id ?? null,
          category_label: line.category_label ?? null,
          description: line.description,
          labour_amount: toNumber(line.labour_amount),
          material_amount: toNumber(line.material_amount),
          discount_amount: toNumber(line.discount_amount),
          taxed: line.taxed ?? true,
          total_cost: line.total_cost,
          product_id: line.product_id ?? null,
          quantity: line.quantity != null ? toNumber(line.quantity) : null,
          unit_price: line.unit_price != null ? toNumber(line.unit_price) : null,
          sort_order: line.sort_order ?? index,
        },
        quotationType,
      ),
  );

  const quotation: ClientQuotationHeaderRow = {
    id: "preview",
    tenant_id: input.tenantId,
    client_id: input.form.client_id,
    opportunity_id: input.form.opportunity_id ?? null,
    quotation_number: input.quotationNumber,
    quotation_sequence: 0,
    document_type: input.form.document_type ?? "quotation",
    quotation_type: quotationType,
    tax_basis: taxBasis,
    issue_date: input.form.issue_date,
    valid_until: input.form.valid_until ?? null,
    bill_to_name: input.form.bill_to_name,
    bill_to_address: input.form.bill_to_address ?? null,
    bill_to_phone: input.form.bill_to_phone ?? null,
    ship_to_name: input.form.ship_to_name ?? null,
    ship_to_address: input.form.ship_to_address ?? null,
    ship_to_phone: input.form.ship_to_phone ?? null,
    subtotal: totals.subtotal,
    vat_nhil_getfund_rate: toNumber(input.form.vat_nhil_getfund_rate),
    tax_due: totals.tax_due,
    wht_rate: toNumber(input.form.wht_rate),
    wht_amount: totals.wht_amount,
    header_discount_amount: totals.header_discount_amount,
    discount_type: discountType,
    discount_percentage:
      discountType === "percentage"
        ? toNumber(input.form.discount_percentage ?? 0)
        : null,
    total_amount_due: totals.total_amount_due,
    status: input.form.status ?? "draft",
    notes: input.form.notes ?? null,
    commercial_terms: input.form.commercial_terms ?? null,
    internal_notes: input.form.internal_notes ?? null,
    payment_terms: input.form.payment_terms ?? null,
    authorized_by_name: input.authorizedBy.authorized_by_name,
    authorized_by_title: input.authorizedBy.authorized_by_title,
    contract_id: null,
    converted_invoice_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    opportunity: input.opportunityName
      ? {
          id: input.form.opportunity_id ?? "",
          opportunity_name: input.opportunityName,
        }
      : null,
  };

  return {
    quotation,
    lineItems,
    paymentAccounts: input.paymentAccounts.filter((account) =>
      input.form.payment_account_ids.includes(account.id),
    ),
    branding: input.branding,
    billingSettings: input.billingSettings,
  };
}

export {
  CLIENT_INVOICE_COLORS,
  CLIENT_INVOICE_LABOUR_TAX_NOTE,
  CLIENT_INVOICE_TOTAL_COST_TAX_NOTE,
  clientInvoiceTaxBasisNote,
  formatInvoiceDate,
  formatInvoiceMoney,
  hasAuthorizedBySignature,
  resolveAuthorizedByDisplayTitle,
  paymentAccountDetailLines,
  resolveBrandingLogoUrl,
  resolveInvoiceCompanyName,
  tenantHeaderContactLines,
};
