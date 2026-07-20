export type CrmSaleEntry = {
  id: string;
  sale_date: string;
  amount: number;
  payment_status: string | null;
  payment_method: string | null;
  customer_id: string | null;
  product_id: string | null;
  customer_name: string;
  product_name: string;
};

type CrmSaleRelation = { client_name?: string | null; name?: string | null };

type CrmSaleRow = {
  id: string;
  sale_date: string;
  amount: number;
  payment_status: string | null;
  payment_method: string | null;
  customer_id: string | null;
  product_id: string | null;
  customer: CrmSaleRelation | CrmSaleRelation[] | null;
  product: CrmSaleRelation | CrmSaleRelation[] | null;
};

export const CRM_SALE_SELECT =
  "id, sale_date, amount, payment_status, payment_method, customer_id, product_id, customer:customers!crm_sales_customer_id_fkey(client_id, client_name), product:crm_products!product_id(name)";

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function normalizeCrmSale(row: CrmSaleRow): CrmSaleEntry {
  const customer = firstRelation(row.customer);
  const product = firstRelation(row.product);

  return {
    id: row.id,
    sale_date: row.sale_date,
    amount: Number(row.amount) || 0,
    payment_status: row.payment_status,
    payment_method: row.payment_method,
    customer_id: row.customer_id,
    product_id: row.product_id,
    customer_name: customer?.client_name?.trim() || row.customer_id || "—",
    product_name: product?.name?.trim() || row.product_id || "—",
  };
}

export function formatSaleAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatSaleDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
