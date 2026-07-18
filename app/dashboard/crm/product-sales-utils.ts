import type { ClientEntry } from "../operations/clients-utils";
import {
  calculateOutstanding,
  formatDate,
  formatGHS,
  getIncomeCustomerDisplayName,
  type IncomeRegisterClient,
  type IncomeRegisterProduct,
  type ProductSaleStatus,
} from "../finance/income-register-utils";
import { formatInventoryQuantity } from "../inventory/inventory-utils";

export type ProductSaleEntry = {
  id: string;
  date: string;
  invoice_no: string;
  client_id: string | null;
  customer_name: string | null;
  amount: number;
  amount_received: number;
  outstanding_balance: number | null;
  payment_status: string;
  due_date: string;
  notes: string | null;
  product_id: string | null;
  sale_quantity: number | null;
  unit_price: number | null;
  sale_status: ProductSaleStatus;
  voided_at: string | null;
  cogs_expense_id: string | null;
  cogs_reversal_expense_id: string | null;
  client?: IncomeRegisterClient | null;
  product?: IncomeRegisterProduct | null;
};

export const PRODUCT_SALES_SELECT =
  "*, client:customers!client_id(client_id, client_name), product:finished_products!product_id(product_code, product_name, unit_of_measure, standard_selling_price)";

export function normalizeProductSaleEntry(raw: ProductSaleEntry): ProductSaleEntry {
  const product = Array.isArray(raw.product)
    ? raw.product[0] ?? null
    : raw.product ?? null;

  return {
    ...raw,
    sale_quantity:
      raw.sale_quantity == null ? null : Number(raw.sale_quantity) || 0,
    unit_price: raw.unit_price == null ? null : Number(raw.unit_price) || 0,
    sale_status: raw.sale_status ?? "active",
    voided_at: raw.voided_at ?? null,
    cogs_expense_id: raw.cogs_expense_id ?? null,
    cogs_reversal_expense_id: raw.cogs_reversal_expense_id ?? null,
    client: Array.isArray(raw.client) ? raw.client[0] ?? null : raw.client ?? null,
    product,
  };
}

export function isProductSaleVoided(entry: Pick<ProductSaleEntry, "sale_status">): boolean {
  return entry.sale_status === "voided";
}

export function buildVoidProductSaleConfirmMessage(entry: ProductSaleEntry): string {
  const quantity = formatInventoryQuantity(entry.sale_quantity ?? 0);
  const unit = entry.product?.unit_of_measure ?? "units";
  const productName = entry.product?.product_name ?? "this product";

  return `Are you sure? This will restore ${quantity} ${unit} of ${productName} to stock and reverse the COGS entry.`;
}

export function getProductSaleProductLabel(entry: ProductSaleEntry): string {
  if (!entry.product?.product_name) {
    return "—";
  }

  return `${entry.product.product_code} — ${entry.product.product_name}`;
}

export {
  calculateOutstanding,
  formatDate,
  formatGHS,
  getIncomeCustomerDisplayName,
};
