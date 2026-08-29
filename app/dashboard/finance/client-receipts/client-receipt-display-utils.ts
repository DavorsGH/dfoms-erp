import type { BillingSettingsHeaderFields } from "@/utils/billing-settings-types";
import type { ClientReceiptHeaderRow } from "@/utils/client-receipts-types";
import type { TenantBranding } from "@/utils/tenant-branding-types";
import { toNumber } from "@/utils/client-invoices-types";
import {
  formatInvoiceDate,
  formatReceiptMoney,
  hasReceiptAuthorizedBy,
  shouldShowReceiptSignatureBlock,
} from "@/utils/client-receipts-types";
import {
  CLIENT_INVOICE_COLORS,
  resolveAuthorizedByDisplayTitle,
  resolveInvoiceCompanyName,
  resolveSignatureImageUrl,
  tenantHeaderContactLines,
} from "../client-invoices/client-invoice-display-utils";

export const CLIENT_RECEIPT_PRINT_AREA_ID = "client-receipt-print-area";

export type ClientReceiptDetailPayload = {
  receipt: ClientReceiptHeaderRow;
  invoice: {
    invoice_number: string;
    bill_to_name: string;
    bill_to_address: string | null;
    bill_to_phone: string | null;
    total_amount_due: number;
    wht_rate: number;
    wht_amount: number;
    client_id: string;
  };
};

export type ClientReceiptDisplayProps = {
  receipt: ClientReceiptHeaderRow;
  invoice: ClientReceiptDetailPayload["invoice"];
  branding: TenantBranding;
  billingSettings: BillingSettingsHeaderFields | null;
  graTin: string | null;
};

export function normalizeClientReceiptDetail(
  payload: ClientReceiptDetailPayload,
): Omit<ClientReceiptDisplayProps, "branding" | "billingSettings" | "graTin"> {
  return {
    receipt: payload.receipt,
    invoice: {
      ...payload.invoice,
      total_amount_due: toNumber(payload.invoice.total_amount_due),
      wht_rate: toNumber(payload.invoice.wht_rate),
      wht_amount: toNumber(payload.invoice.wht_amount),
    },
  };
}

export type ReceiptAmountBreakdown = {
  showWht: boolean;
  invoiceTotal: number;
  whtRate: number;
  whtAmount: number;
  netReceived: number;
};

export function buildReceiptAmountBreakdown(
  invoice: Pick<
    ClientReceiptDetailPayload["invoice"],
    "total_amount_due" | "wht_rate" | "wht_amount"
  >,
  receiptAmount: unknown,
): ReceiptAmountBreakdown {
  const whtAmount = toNumber(invoice.wht_amount);
  const netReceived = toNumber(receiptAmount);

  return {
    showWht: whtAmount > 0,
    invoiceTotal: toNumber(invoice.total_amount_due),
    whtRate: toNumber(invoice.wht_rate),
    whtAmount,
    netReceived,
  };
}

/**
 * Plain-text amount block for receipt_issued email templates ({{amount_section}}).
 * Matches screen/PDF: WHT breakdown when wht_amount > 0; otherwise a single Amount line.
 */
export function formatReceiptAmountSectionForEmail(
  invoice: Pick<
    ClientReceiptDetailPayload["invoice"],
    "total_amount_due" | "wht_rate" | "wht_amount"
  >,
  receiptAmount: unknown,
): string {
  const breakdown = buildReceiptAmountBreakdown(invoice, receiptAmount);
  if (!breakdown.showWht) {
    return `Amount: ${formatReceiptMoney(breakdown.netReceived)}`;
  }

  return [
    `Invoice Total: ${formatReceiptMoney(breakdown.invoiceTotal)}`,
    `WHT Withheld (${breakdown.whtRate}%): ${formatReceiptMoney(breakdown.whtAmount)}`,
    `Net Amount Received: ${formatReceiptMoney(breakdown.netReceived)}`,
  ].join("\n");
}

export {
  formatInvoiceDate,
  formatReceiptMoney,
  hasReceiptAuthorizedBy,
  resolveAuthorizedByDisplayTitle,
  shouldShowReceiptSignatureBlock,
  CLIENT_INVOICE_COLORS,
  resolveInvoiceCompanyName,
  tenantHeaderContactLines,
  resolveSignatureImageUrl,
};
