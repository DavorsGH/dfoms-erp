import {
  formatInvoiceDate,
  formatInvoiceMoney,
  groupLineItemsByCategory,
  roundMoney,
  toNumber,
  type ClientQuotationHeaderRow,
  type ClientQuotationLineItemRow,
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

  return {
    quotation: {
      ...quotation,
      subtotal: toNumber(quotation.subtotal),
      vat_nhil_getfund_rate: toNumber(quotation.vat_nhil_getfund_rate) || 20,
      tax_due: toNumber(quotation.tax_due),
      wht_rate: toNumber(quotation.wht_rate) || 7.5,
      wht_amount: toNumber(quotation.wht_amount),
      total_amount_due: toNumber(quotation.total_amount_due),
    },
    lineItems: [...payload.line_items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((line) => ({
        ...line,
        labour_amount: toNumber(line.labour_amount),
        material_amount: toNumber(line.material_amount),
        discount_amount: toNumber(line.discount_amount),
        total_cost: toNumber(line.total_cost),
      })),
    paymentAccounts: payload.payment_accounts,
    branding: {
      workspaceName: "",
      workspaceLogoUrl: "",
      companyLegalName: "",
      address: null,
      phone: null,
      email: null,
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

export function quotationPrintTitle(documentType: string) {
  return documentType === "proforma_invoice" ? "PRO-FORMA INVOICE" : "QUOTATION";
}

export function quotationValidityFooter(validUntil: string | null | undefined) {
  if (!validUntil) {
    return "This document is subject to the validity period shown above.";
  }

  return `This document is valid until ${formatInvoiceDate(validUntil)} unless otherwise agreed in writing.`;
}

export {
  CLIENT_INVOICE_COLORS,
  CLIENT_INVOICE_LABOUR_TAX_NOTE,
  CLIENT_INVOICE_TOTAL_COST_TAX_NOTE,
  clientInvoiceTaxBasisNote,
  formatInvoiceDate,
  formatInvoiceMoney,
  hasAuthorizedBySignature,
  paymentAccountDetailLines,
  resolveBrandingLogoUrl,
  resolveInvoiceCompanyName,
  tenantHeaderContactLines,
};
