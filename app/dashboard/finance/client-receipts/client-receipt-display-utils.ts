import type { BillingSettingsHeaderFields } from "@/utils/billing-settings-types";
import type { ClientReceiptHeaderRow } from "@/utils/client-receipts-types";
import type { TenantBranding } from "@/utils/tenant-branding-types";
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
    invoice: payload.invoice,
  };
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
