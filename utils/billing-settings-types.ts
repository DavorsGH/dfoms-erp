export type BillingSettingsRow = {
  tenant_id: string;
  credit_balance: number | null;
  email_recipient: string | null;
  additional_emails: string | null;
  bill_to_name: string | null;
  country_region: string | null;
  address_line1: string | null;
  business_tax_id: string | null;
};

export type BillingInvoiceRow = {
  id: string;
  invoice_date: string | null;
  amount: number | null;
  invoice_number: string | null;
  status: string | null;
};

export type BillingSettingsUpdateBody = {
  email_recipient?: string;
  additional_emails?: string;
  bill_to_name?: string;
  country_region?: string;
  address_line1?: string;
  business_tax_id?: string;
};

export const BILLING_SETTINGS_SELECT =
  "tenant_id, credit_balance, email_recipient, additional_emails, bill_to_name, country_region, address_line1, business_tax_id";

export const BILLING_INVOICE_SELECT =
  "id, invoice_date, amount, invoice_number, status";

export function emptyBillingSettings(tenantId: string): BillingSettingsRow {
  return {
    tenant_id: tenantId,
    credit_balance: 0,
    email_recipient: "",
    additional_emails: "",
    bill_to_name: "",
    country_region: "",
    address_line1: "",
    business_tax_id: "",
  };
}

export function formatCreditBalance(value: number | null | undefined): string {
  const amount = value ?? 0;
  return `GHS ${Number(amount).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatInvoiceDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatInvoiceAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatBillingPlanState(
  subscriptionStatus: string | null,
  tierName: string | null,
): string {
  if (!subscriptionStatus) {
    return "Free";
  }

  if (subscriptionStatus === "trialing") {
    return "Trial";
  }

  if (tierName) {
    return tierName;
  }

  return subscriptionStatus.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatInvoiceStatus(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
