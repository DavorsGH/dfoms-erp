import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import { roundMoney, toNumber } from "@/utils/client-invoices-types";
import {
  getActivityTypeLabel,
  getOpportunityStageLabel,
  isActivityComplete,
  type SalesActivity,
} from "../sales-pipeline/sales-pipeline-utils";
import {
  formatQuoteMoney,
  formatQuoteStatus,
  formatQuoteType,
  quoteStatusBadgeClassName,
  type QuoteStatus,
} from "@/utils/sales-quotes-types";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  formatInvoiceStatus,
} from "@/utils/client-invoices-types";
import {
  getCustomerStatusLabel,
  getCustomerTypeLabel,
  type CustomerEntry,
} from "./customers-utils";

import {
  formatLoyaltyPoints,
  formatLoyaltyTransactionType,
  loyaltyTransactionBadgeClassName,
  normalizeLoyaltyAccount,
  normalizeLoyaltyTransaction,
  type LoyaltyAccountRow,
  type LoyaltyTransactionRow,
} from "@/utils/loyalty-types";

export type Customer360LoyaltyAccount = LoyaltyAccountRow;
export type Customer360LoyaltyTransaction = LoyaltyTransactionRow;

export const CUSTOMER_360_LOYALTY_TRANSACTION_SELECT =
  "id, tenant_id, client_id, transaction_type, points, source_type, source_reference, notes, created_at";

export function formatLoyaltyTransactionDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export {
  formatLoyaltyPoints,
  formatLoyaltyTransactionType,
  loyaltyTransactionBadgeClassName,
  normalizeLoyaltyAccount,
  normalizeLoyaltyTransaction,
};

export type Customer360Opportunity = {
  id: string;
  opportunity_name: string;
  stage: string;
  estimated_value: number | null;
  expected_close_date: string | null;
  updated_at: string;
};

export type Customer360Quote = {
  id: string;
  quote_number: string;
  quote_type: string;
  quote_date: string;
  status: QuoteStatus;
  total_amount: number;
};

export type Customer360Invoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  total_amount_due: number;
  amount_received: number;
};

export type Customer360ProductSale = {
  id: string;
  date: string;
  invoice_no: string;
  amount: number;
  amount_received: number;
  payment_status: string;
  sale_quantity: number | null;
  sale_status: string | null;
  product?:
    | { product_code: string; product_name: string }
    | { product_code: string; product_name: string }[]
    | null;
};

export type Customer360Summary = {
  totalProductSales: number;
  totalInvoiced: number;
  totalReceived: number;
  daysSinceLastActivity: number | null;
};

export const CUSTOMER_360_OPPORTUNITY_SELECT =
  "id, opportunity_name, stage, estimated_value, expected_close_date, updated_at";

export const CUSTOMER_360_QUOTE_SELECT =
  "id, quote_number, quote_type, quote_date, status, total_amount";

export const CUSTOMER_360_INVOICE_SELECT =
  "id, invoice_number, invoice_date, status, total_amount_due, amount_received";

export const CUSTOMER_360_PRODUCT_SALE_SELECT =
  "id, date, invoice_no, amount, amount_received, payment_status, sale_quantity, sale_status, product:finished_products(product_code, product_name)";

export const CUSTOMER_360_TABS = [
  { id: "opportunities", label: "Opportunities" },
  { id: "quotes", label: "Quotes" },
  { id: "invoices", label: "Invoices" },
  { id: "product-sales", label: "Product Sales" },
  { id: "loyalty", label: "Loyalty" },
  { id: "activities", label: "Activities" },
] as const;

export type Customer360TabId = (typeof CUSTOMER_360_TABS)[number]["id"];

export function isProductSaleVoided(
  entry: Pick<Customer360ProductSale, "sale_status">,
): boolean {
  return entry.sale_status === "voided";
}

export function normalizeCustomer360Opportunity(
  row: Customer360Opportunity,
): Customer360Opportunity {
  return {
    ...row,
    estimated_value:
      row.estimated_value == null ? null : toNumber(row.estimated_value),
    expected_close_date: row.expected_close_date?.slice(0, 10) ?? null,
  };
}

export function normalizeCustomer360Quote(row: Customer360Quote): Customer360Quote {
  return {
    ...row,
    total_amount: toNumber(row.total_amount),
  };
}

export function normalizeCustomer360Invoice(
  row: Customer360Invoice,
): Customer360Invoice {
  return {
    ...row,
    total_amount_due: toNumber(row.total_amount_due),
    amount_received: toNumber(row.amount_received),
  };
}

export function normalizeCustomer360ProductSale(
  row: Customer360ProductSale,
): Customer360ProductSale {
  return {
    ...row,
    amount: toNumber(row.amount),
    amount_received: toNumber(row.amount_received),
    sale_quantity: row.sale_quantity == null ? null : toNumber(row.sale_quantity),
    sale_status: row.sale_status ?? "active",
    product: Array.isArray(row.product) ? row.product[0] ?? null : row.product ?? null,
  };
}

export function getProductSaleLabel(entry: Customer360ProductSale): string {
  const product = Array.isArray(entry.product)
    ? entry.product[0]
    : entry.product;
  if (!product?.product_name) {
    return "—";
  }
  return `${product.product_code} — ${product.product_name}`;
}

export function computeCustomer360Summary(
  productSales: Customer360ProductSale[],
  invoices: Customer360Invoice[],
  activities: SalesActivity[],
): Customer360Summary {
  const totalProductSales = roundMoney(
    productSales
      .filter((entry) => !isProductSaleVoided(entry))
      .reduce((sum, entry) => sum + entry.amount, 0),
  );

  const totalInvoiced = roundMoney(
    invoices.reduce((sum, entry) => sum + entry.total_amount_due, 0),
  );

  const productSalesReceived = roundMoney(
    productSales
      .filter((entry) => !isProductSaleVoided(entry))
      .reduce((sum, entry) => sum + entry.amount_received, 0),
  );

  const invoicesReceived = roundMoney(
    invoices.reduce((sum, entry) => sum + entry.amount_received, 0),
  );

  const activityTimestamps = activities
    .map((activity) => activity.completed_at ?? activity.created_at)
    .filter(Boolean)
    .map((value) => Date.parse(value as string))
    .filter((value) => Number.isFinite(value));

  let daysSinceLastActivity: number | null = null;
  if (activityTimestamps.length > 0) {
    const latest = Math.max(...activityTimestamps);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const latestDate = new Date(latest);
    latestDate.setHours(0, 0, 0, 0);
    daysSinceLastActivity = Math.max(
      0,
      Math.round((today.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24)),
    );
  }

  return {
    totalProductSales,
    totalInvoiced,
    totalReceived: roundMoney(productSalesReceived + invoicesReceived),
    daysSinceLastActivity,
  };
}

export function customerStatusBadgeClassName(status: string | null | undefined) {
  switch (status) {
    case "lead":
      return "bg-sky-100 text-sky-900";
    case "inactive":
      return "bg-slate-100 text-slate-700";
    case "active":
      return "bg-emerald-100 text-emerald-900";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

export function formatCustomer360ContractPeriod(
  customer: Pick<CustomerEntry, "contract_start" | "contract_end">,
) {
  const start = customer.contract_start
    ? formatInvoiceDate(customer.contract_start)
    : "—";
  const end = customer.contract_end
    ? formatInvoiceDate(customer.contract_end)
    : "—";
  return `${start} → ${end}`;
}

export function formatDaysSinceLastActivity(days: number | null) {
  if (days == null) {
    return "—";
  }
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "1 day";
  }
  return `${days} days`;
}

export {
  formatGHS,
  formatInvoiceDate,
  formatInvoiceMoney,
  formatInvoiceStatus,
  formatQuoteMoney,
  formatQuoteStatus,
  formatQuoteType,
  getActivityTypeLabel,
  getCustomerStatusLabel,
  getCustomerTypeLabel,
  getOpportunityStageLabel,
  isActivityComplete,
  quoteStatusBadgeClassName,
};
