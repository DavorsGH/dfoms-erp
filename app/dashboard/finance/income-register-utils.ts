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
  "*, client:customers!client_id(client_id, client_name)";

export const RECEIVABLES_INCOME_SELECT = SERVICE_INCOME_REGISTER_SELECT;

export function normalizeIncomeRegisterEntry(
  raw: IncomeRegisterEntry,
): IncomeRegisterEntry {
  return {
    ...raw,
    entry_type: raw.entry_type ?? "service",
    sale_status: raw.sale_status ?? "active",
    service_category: raw.service_category ?? null,
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
): number {
  return amount - amountReceived;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
