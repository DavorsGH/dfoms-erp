import {
  formatInvoiceDate,
  formatInvoiceMoney,
  groupLineItemsByCategory,
  roundMoney,
  toNumber,
  type ClientInvoiceHeaderRow,
  type ClientInvoiceLineItemRow,
} from "@/utils/client-invoices-types";
import type { BillingSettingsHeaderFields } from "@/utils/billing-settings-types";
import type { PaymentAccountRow } from "@/utils/payment-accounts-types";
import type { TenantBranding } from "@/utils/tenant-branding-types";

export const CLIENT_INVOICE_PRINT_AREA_ID = "client-invoice-print-area";

export type ClientInvoiceDetailPayload = {
  client_invoice: ClientInvoiceHeaderRow;
  line_items: ClientInvoiceLineItemRow[];
  payment_account_ids: string[];
  payment_accounts: PaymentAccountRow[];
};

export type ClientInvoiceDisplayProps = {
  invoice: ClientInvoiceHeaderRow;
  lineItems: ClientInvoiceLineItemRow[];
  paymentAccounts: PaymentAccountRow[];
  branding: TenantBranding;
  billingSettings: BillingSettingsHeaderFields | null;
};

function splitAddressLines(address: string) {
  return address
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function resolveInvoiceCompanyName(
  branding: TenantBranding,
  billingSettings: BillingSettingsHeaderFields | null | undefined,
) {
  const billToName = billingSettings?.bill_to_name?.trim();
  if (billToName) {
    return billToName;
  }

  return branding.companyLegalName || branding.workspaceName;
}

export function resolveInvoiceCompanyAddressLines(
  branding: TenantBranding,
  billingSettings: BillingSettingsHeaderFields | null | undefined,
) {
  const addressLine1 = billingSettings?.address_line1?.trim();
  if (addressLine1) {
    const lines = [addressLine1];
    const countryRegion = billingSettings?.country_region?.trim();
    if (countryRegion) {
      lines.push(countryRegion);
    }
    return lines;
  }

  if (branding.address?.trim()) {
    return splitAddressLines(branding.address);
  }

  return [];
}

export function tenantHeaderContactLines(
  branding: TenantBranding,
  billingSettings: BillingSettingsHeaderFields | null | undefined = null,
) {
  const lines = resolveInvoiceCompanyAddressLines(branding, billingSettings);

  if (branding.phone?.trim()) {
    lines.push(branding.phone.trim());
  }

  if (branding.email?.trim()) {
    lines.push(branding.email.trim());
  }

  return lines;
}

export function normalizeClientInvoiceDetail(
  payload: ClientInvoiceDetailPayload,
): ClientInvoiceDisplayProps {
  const invoice = payload.client_invoice;

  return {
    invoice: {
      ...invoice,
      subtotal: toNumber(invoice.subtotal),
      vat_nhil_getfund_rate: toNumber(invoice.vat_nhil_getfund_rate) || 20,
      tax_due: toNumber(invoice.tax_due),
      wht_rate: toNumber(invoice.wht_rate) || 7.5,
      wht_amount: toNumber(invoice.wht_amount),
      total_amount_due: toNumber(invoice.total_amount_due),
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

export function resolveBrandingLogoUrl(logoUrl: string) {
  if (!logoUrl) {
    return "";
  }

  if (logoUrl.startsWith("http://") || logoUrl.startsWith("https://")) {
    return logoUrl;
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}${logoUrl.startsWith("/") ? logoUrl : `/${logoUrl}`}`;
  }

  return logoUrl;
}

export function paymentAccountDetailLines(account: PaymentAccountRow) {
  const lines: Array<{ label: string; value: string }> = [];

  if (account.account_name?.trim()) {
    lines.push({ label: "Account Name", value: account.account_name.trim() });
  }

  if (account.bank_name?.trim()) {
    lines.push({ label: "Bank Name", value: account.bank_name.trim() });
  }

  if (account.bank_account_number?.trim()) {
    lines.push({
      label: "Bank Account Number",
      value: account.bank_account_number.trim(),
    });
  }

  if (account.momo_merchant_name?.trim()) {
    lines.push({
      label: "MoMo Merchant Name",
      value: account.momo_merchant_name.trim(),
    });
  }

  if (account.momo_provider?.trim()) {
    lines.push({ label: "MoMo Provider", value: account.momo_provider.trim() });
  }

  if (account.momo_number?.trim()) {
    lines.push({ label: "Merchant Number", value: account.momo_number.trim() });
  }

  if (account.momo_merchant_id?.trim()) {
    lines.push({ label: "Merchant ID", value: account.momo_merchant_id.trim() });
  }

  return lines;
}

export function buildClientInvoiceGroups(lineItems: ClientInvoiceLineItemRow[]) {
  return groupLineItemsByCategory(lineItems);
}

export function sumLineItemColumns(lineItems: ClientInvoiceLineItemRow[]) {
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

/** Fixed column widths for the shared line-items table (view + PDF). */
export const CLIENT_INVOICE_LINE_TABLE_COLUMNS = {
  description: "40%",
  amount: "15%",
} as const;

export function formatBillingPeriodLabel(
  start: string | null | undefined,
  end: string | null | undefined,
) {
  if (!start && !end) {
    return null;
  }

  if (start && end) {
    return `${formatInvoiceDate(start)} – ${formatInvoiceDate(end)}`;
  }

  return formatInvoiceDate(start ?? end);
}

export const CLIENT_INVOICE_PAYMENT_FOOTER =
  "Payment is due within 30 days. Please include the invoice number on your payment.";

export const CLIENT_INVOICE_LABOUR_TAX_NOTE = "Calculated on Service cost only";

/** Shared invoice palette — keep view + PDF in sync. */
export const CLIENT_INVOICE_COLORS = {
  navy: "#0f2744",
  gold: "#c9a227",
  tealLight: "#e8f4f8",
  tealBand: "#d4ecef",
  navyBand: "#dce4ed",
  cream: "#faf8f5",
  textDark: "#1e293b",
  textMuted: "#475569",
  textOnNavy: "#f1f5f9",
  white: "#ffffff",
} as const;

export { formatInvoiceDate, formatInvoiceMoney };
