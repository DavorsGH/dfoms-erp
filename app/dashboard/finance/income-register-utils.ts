import type { ClientEntry } from "../operations/clients-utils";

export type IncomeEntryType = "service" | "product_sale";

export type ProductSaleStatus = "active" | "voided";

export const PRODUCT_SALES_REVENUE_CATEGORY = "Product Sales";

export type IncomeRegisterClient = {
  client_id: string;
  client_name: string;
};

export type IncomeRegisterProduct = {
  product_code: string;
  product_name: string;
  unit_of_measure: string;
  standard_selling_price: number | null;
};

export type IncomeRegisterEntry = {
  id: string;
  date: string;
  invoice_no: string;
  client_id: string | null;
  customer_name: string | null;
  entry_type: IncomeEntryType;
  service_category: string | null;
  description: string | null;
  amount: number;
  amount_received: number;
  outstanding_balance: number | null;
  payment_status: string;
  due_date: string;
  notes: string | null;
  net_of_tax_amount?: number | null;
  output_tax_component?: "vat_bundle" | "vfrs" | null;
  output_vat_amount?: number | null;
  wht_rate?: number | null;
  wht_amount?: number | null;
  tax_inclusive?: boolean | null;
  /**
   * Non-cash system P&L adjustment (payroll DEDSAV, forfeited-wage ADJ, …).
   * Must not carry AR outstanding or VAT/WHT tax_ledger legs.
   */
  is_system_adjustment?: boolean | null;
  product_id: string | null;
  sale_quantity: number | null;
  unit_price: number | null;
  sale_status?: ProductSaleStatus | null;
  voided_at?: string | null;
  cogs_expense_id?: string | null;
  cogs_reversal_expense_id?: string | null;
  client?: IncomeRegisterClient | null;
  product?: IncomeRegisterProduct | null;
};

export const SERVICE_INCOME_REGISTER_SELECT =
  "*, client:customers!income_register_client_id_fkey(client_id, client_name)";

export const RECEIVABLES_INCOME_SELECT = SERVICE_INCOME_REGISTER_SELECT;

function toNullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value) || 0;
}

export function normalizeIncomeRegisterEntry(
  raw: IncomeRegisterEntry,
): IncomeRegisterEntry {
  return {
    ...raw,
    entry_type: raw.entry_type ?? "service",
    sale_status: raw.sale_status ?? "active",
    service_category: raw.service_category ?? null,
    net_of_tax_amount: toNullableNumber(raw.net_of_tax_amount),
    output_tax_component: raw.output_tax_component ?? null,
    output_vat_amount: toNullableNumber(raw.output_vat_amount),
    wht_rate: toNullableNumber(raw.wht_rate),
    wht_amount: toNullableNumber(raw.wht_amount),
    tax_inclusive: raw.tax_inclusive ?? true,
    is_system_adjustment: Boolean(raw.is_system_adjustment),
    sale_quantity:
      raw.sale_quantity == null ? null : Number(raw.sale_quantity) || 0,
    unit_price: raw.unit_price == null ? null : Number(raw.unit_price) || 0,
    client: Array.isArray(raw.client) ? raw.client[0] ?? null : raw.client ?? null,
    product: Array.isArray(raw.product)
      ? raw.product[0] ?? null
      : raw.product ?? null,
  };
}

export function resolveProfitLossRevenueCategory(entry: {
  entry_type?: IncomeEntryType | null;
  service_category?: string | null;
}): string {
  if (entry.entry_type === "product_sale") {
    return PRODUCT_SALES_REVENUE_CATEGORY;
  }

  return entry.service_category?.trim() || "Uncategorized";
}

export function isVoidedProductSale(entry: {
  entry_type?: IncomeEntryType | null;
  sale_status?: ProductSaleStatus | null;
}): boolean {
  return (
    entry.entry_type === "product_sale" && entry.sale_status === "voided"
  );
}

export function isActiveIncomeForReporting(entry: {
  entry_type?: IncomeEntryType | null;
  sale_status?: ProductSaleStatus | null;
}): boolean {
  return !isVoidedProductSale(entry);
}

export function getIncomeCustomerDisplayName(
  entry: {
    client?: IncomeRegisterClient | null;
    client_id?: string | null;
    customer_name?: string | null;
  },
  clients?: ClientEntry[],
): string {
  if (entry.client?.client_name?.trim()) {
    return entry.client.client_name.trim();
  }

  if (entry.client_id && clients) {
    const match = clients.find((client) => client.client_id === entry.client_id);
    if (match?.client_name?.trim()) {
      return match.client_name.trim();
    }
  }

  if (entry.customer_name?.trim()) {
    return entry.customer_name.trim();
  }

  return "—";
}

export function formatGHS(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function calculateOutstanding(
  amount: number,
  amountReceived: number,
  whtAmount: number = 0,
): number {
  return calculateIncomeOutstanding(amount, amountReceived, whtAmount);
}

/**
 * Amount − Amount Received − WHT Amount, clamped at zero.
 *
 * WHT the customer withholds is remitted to GRA on our behalf, so it is never
 * collectable from the customer: an invoice settled net of WHT is fully paid and
 * must show a zero outstanding balance.
 */
export function calculateIncomeOutstanding(
  amount: number,
  amountReceived: number,
  whtAmount: number = 0,
): number {
  const outstanding =
    (Number(amount) || 0) -
    (Number(amountReceived) || 0) -
    (Number(whtAmount) || 0);

  return Math.max(0, Math.round(outstanding * 100) / 100);
}

export function getIncomeEntryOutstanding(entry: {
  amount: number;
  amount_received: number;
  wht_amount?: number | null;
}): number {
  return calculateIncomeOutstanding(
    Number(entry.amount) || 0,
    Number(entry.amount_received) || 0,
    Number(entry.wht_amount) || 0,
  );
}

/**
 * Prefer a stamped outstanding_balance when present (clamped); otherwise
 * recompute via calculateIncomeOutstanding. Single path for BS, aging, and
 * Paystack line totals.
 */
export function resolveIncomeOutstandingBalance(entry: {
  amount: number;
  amount_received: number;
  wht_amount?: number | null;
  outstanding_balance?: number | null;
}): number {
  if (
    entry.outstanding_balance !== null &&
    entry.outstanding_balance !== undefined
  ) {
    return Math.max(
      0,
      Math.round((Number(entry.outstanding_balance) || 0) * 100) / 100,
    );
  }

  return getIncomeEntryOutstanding(entry);
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
