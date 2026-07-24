import {
  formatDate,
  formatGHS,
  getIncomeCustomerDisplayName,
} from "../../finance/income-register-utils";
import {
  getProductSaleProductLabel,
  normalizeProductSaleEntry,
  PRODUCT_SALES_SELECT,
  type ProductSaleEntry,
} from "../product-sales-utils";

export type CrmSaleSource = "product_sale" | "webhook";

export type CrmSaleEntry = {
  id: string;
  sale_date: string;
  invoice_no: string | null;
  amount: number;
  payment_status: string | null;
  payment_method: string | null;
  sale_status: string | null;
  customer_id: string | null;
  product_id: string | null;
  customer_name: string;
  product_name: string;
  source: CrmSaleSource;
};

type WebhookSaleRelation = { client_name?: string | null; name?: string | null };

type WebhookSaleRow = {
  id: string;
  sale_date: string;
  amount: number;
  payment_status: string | null;
  payment_method: string | null;
  customer_id: string | null;
  product_id: string | null;
  customer: WebhookSaleRelation | WebhookSaleRelation[] | null;
  product: WebhookSaleRelation | WebhookSaleRelation[] | null;
};

export const CRM_WEBHOOK_SALE_SELECT =
  "id, sale_date, amount, payment_status, payment_method, customer_id, product_id, customer:customers!crm_sales_customer_id_fkey(client_id, client_name), product:crm_products!product_id(name)";

export const CRM_PRODUCT_SALE_SELECT = PRODUCT_SALES_SELECT;

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function paymentMethodFromInvoice(invoiceNo: string | null | undefined): string {
  const trimmed = invoiceNo?.trim() ?? "";
  if (/^POS/i.test(trimmed)) {
    return "POS";
  }
  if (/^PSI/i.test(trimmed)) {
    return "Product Sale";
  }
  return "—";
}

export function normalizeProductSaleForLog(
  raw: ProductSaleEntry,
): CrmSaleEntry {
  const entry = normalizeProductSaleEntry(raw);

  return {
    id: entry.id,
    sale_date: entry.date,
    invoice_no: entry.invoice_no,
    amount: Number(entry.amount) || 0,
    payment_status: entry.payment_status,
    payment_method: paymentMethodFromInvoice(entry.invoice_no),
    sale_status: entry.sale_status ?? "active",
    customer_id: entry.client_id,
    product_id: entry.product_id,
    customer_name: getIncomeCustomerDisplayName(entry),
    product_name: getProductSaleProductLabel(entry),
    source: "product_sale",
  };
}

export function normalizeWebhookSale(row: WebhookSaleRow): CrmSaleEntry {
  const customer = firstRelation(row.customer);
  const product = firstRelation(row.product);

  return {
    id: row.id,
    sale_date: row.sale_date,
    invoice_no: null,
    amount: Number(row.amount) || 0,
    payment_status: row.payment_status,
    payment_method: row.payment_method,
    sale_status: null,
    customer_id: row.customer_id,
    product_id: row.product_id,
    customer_name: customer?.client_name?.trim() || row.customer_id || "—",
    product_name: product?.name?.trim() || row.product_id || "—",
    source: "webhook",
  };
}

export function mergeSalesLogEntries(
  productSales: CrmSaleEntry[],
  webhookSales: CrmSaleEntry[],
): CrmSaleEntry[] {
  return [...productSales, ...webhookSales].sort((left, right) => {
    const dateCompare = String(right.sale_date).localeCompare(
      String(left.sale_date),
    );
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return String(right.id).localeCompare(String(left.id));
  });
}

export function formatSaleAmount(value: number | null | undefined): string {
  return formatGHS(Number(value) || 0);
}

export function formatSaleDate(value: string | null | undefined): string {
  return formatDate(value ?? "");
}

export function formatSaleSource(source: CrmSaleSource): string {
  return source === "product_sale" ? "Product Sale" : "Webhook";
}
