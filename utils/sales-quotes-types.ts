import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import {
  computeLineTotalCost,
  roundMoney,
  toNumber,
} from "@/utils/client-invoices-types";

export const QUOTE_TYPES = ["service", "product"] as const;
export type QuoteType = (typeof QUOTE_TYPES)[number];

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "converted",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const SALES_QUOTE_LIST_SELECT =
  "id, tenant_id, client_id, opportunity_id, quote_number, quote_type, quote_date, expiry_date, bill_to_name, subtotal, discount_amount, total_amount, status, created_at, client:customers(client_id, client_name)" as const;

export const SALES_QUOTE_HEADER_SELECT =
  "id, tenant_id, client_id, opportunity_id, quote_number, quote_type, quote_date, expiry_date, bill_to_name, bill_to_address, subtotal, discount_amount, total_amount, status, notes, converted_invoice_id, created_at, updated_at" as const;

export const SALES_QUOTE_LINE_ITEM_SELECT =
  "id, quote_id, tenant_id, product_id, site_id, category_label, description, quantity, unit_price, labour_amount, material_amount, discount_amount, total_cost, sort_order, product:finished_products(id, product_code, product_name, unit_of_measure)" as const;

export type SalesQuoteCustomer = {
  client_id: string;
  client_name: string;
};

export type SalesQuoteListRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  opportunity_id: string | null;
  quote_number: string;
  quote_type: QuoteType;
  quote_date: string;
  expiry_date: string | null;
  bill_to_name: string;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  status: QuoteStatus;
  created_at: string;
  client?: SalesQuoteCustomer | SalesQuoteCustomer[] | null;
};

export type SalesQuoteHeaderRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  opportunity_id: string | null;
  quote_number: string;
  quote_type: QuoteType;
  quote_date: string;
  expiry_date: string | null;
  bill_to_name: string;
  bill_to_address: string | null;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  status: QuoteStatus;
  notes: string | null;
  converted_invoice_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SalesQuoteLineItemRow = {
  id: string;
  quote_id: string;
  tenant_id: string;
  product_id: string | null;
  site_id: string | null;
  category_label: string | null;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  labour_amount: number;
  material_amount: number;
  discount_amount: number;
  total_cost: number;
  sort_order: number;
  product?:
    | {
        id: string;
        product_code: string;
        product_name: string;
        unit_of_measure: string;
      }
    | {
        id: string;
        product_code: string;
        product_name: string;
        unit_of_measure: string;
      }[]
    | null;
};

export type SalesQuoteLineItemRpcInput = {
  product_id?: string | null;
  site_id?: string | null;
  category_label?: string | null;
  description: string;
  quantity?: number | null;
  unit_price?: number | null;
  labour_amount?: number;
  material_amount?: number;
  discount_amount?: number;
  total_cost: number;
  sort_order: number;
};

export type ServiceQuoteFormLineItem = {
  key: string;
  site_id: string | null;
  category_label: string;
  description: string;
  labour_amount: number;
  material_amount: number;
  discount_amount: number;
  sort_order: number;
};

export type ProductQuoteFormLineItem = {
  key: string;
  product_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  sort_order: number;
};

export type QuoteFormState = {
  client_id: string;
  opportunity_id: string;
  quote_type: QuoteType;
  expiry_date: string;
  bill_to_name: string;
  bill_to_address: string;
  notes: string;
  service_line_items: ServiceQuoteFormLineItem[];
  product_line_items: ProductQuoteFormLineItem[];
};

export type SalesQuoteSiteOption = {
  site_code: string;
  site_name: string;
  client_id: string;
};

export function defaultQuoteExpiryDate(fromDate = new Date()) {
  const expiry = new Date(fromDate);
  expiry.setDate(expiry.getDate() + 30);
  return expiry.toISOString().slice(0, 10);
}

export function formatQuoteMoney(value: unknown) {
  return formatGHS(toNumber(value));
}

export function formatQuoteDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatQuoteType(type: string | null | undefined) {
  if (type === "product") return "Product";
  if (type === "service") return "Service";
  return type ?? "—";
}

export function formatQuoteStatus(status: string | null | undefined) {
  switch (status) {
    case "sent":
      return "Sent";
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
    case "converted":
      return "Converted";
    default:
      return "Draft";
  }
}

export function quoteStatusBadgeClassName(status: string | null | undefined) {
  switch (status) {
    case "sent":
      return "bg-sky-100 text-sky-900";
    case "accepted":
      return "bg-emerald-100 text-emerald-900";
    case "rejected":
      return "bg-red-100 text-red-900";
    case "expired":
      return "bg-amber-100 text-amber-950";
    case "converted":
      return "bg-violet-100 text-violet-900";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

export function computeServiceLineTotal(line: {
  labour_amount: unknown;
  material_amount: unknown;
  discount_amount: unknown;
}) {
  return computeLineTotalCost(line);
}

export function computeProductLineTotal(line: {
  quantity: unknown;
  unit_price: unknown;
}) {
  return roundMoney(toNumber(line.quantity) * toNumber(line.unit_price));
}

export function computeQuoteTotals(
  quoteType: QuoteType,
  serviceLines: ServiceQuoteFormLineItem[],
  productLines: ProductQuoteFormLineItem[],
) {
  if (quoteType === "service") {
    const lineTotals = serviceLines.map((line) => ({
      ...line,
      total_cost: computeServiceLineTotal(line),
    }));
    const subtotal = roundMoney(
      lineTotals.reduce((sum, line) => sum + line.total_cost, 0),
    );
    return {
      subtotal,
      discount_amount: 0,
      total_amount: subtotal,
      line_items: lineTotals.map((line, index) =>
        serviceLineToRpcInput(line, index),
      ),
    };
  }

  const lineTotals = productLines.map((line) => ({
    ...line,
    total_cost: computeProductLineTotal(line),
  }));
  const subtotal = roundMoney(
    lineTotals.reduce((sum, line) => sum + line.total_cost, 0),
  );
  return {
    subtotal,
    discount_amount: 0,
    total_amount: subtotal,
    line_items: lineTotals.map((line, index) =>
      productLineToRpcInput(line, index),
    ),
  };
}

export function serviceLineToRpcInput(
  line: ServiceQuoteFormLineItem,
  sortOrder: number,
): SalesQuoteLineItemRpcInput {
  return {
    product_id: null,
    site_id: line.site_id || null,
    category_label: line.category_label.trim() || null,
    description: line.description.trim(),
    quantity: null,
    unit_price: null,
    labour_amount: toNumber(line.labour_amount),
    material_amount: toNumber(line.material_amount),
    discount_amount: toNumber(line.discount_amount),
    total_cost: computeServiceLineTotal(line),
    sort_order: sortOrder,
  };
}

export function productLineToRpcInput(
  line: ProductQuoteFormLineItem,
  sortOrder: number,
): SalesQuoteLineItemRpcInput {
  return {
    product_id: line.product_id,
    site_id: null,
    category_label: null,
    description: line.description.trim(),
    quantity: toNumber(line.quantity),
    unit_price: toNumber(line.unit_price),
    labour_amount: 0,
    material_amount: 0,
    discount_amount: 0,
    total_cost: computeProductLineTotal(line),
    sort_order: sortOrder,
  };
}

export function emptyServiceQuoteLine(sortOrder: number): ServiceQuoteFormLineItem {
  return {
    key: crypto.randomUUID(),
    site_id: null,
    category_label: "",
    description: "",
    labour_amount: 0,
    material_amount: 0,
    discount_amount: 0,
    sort_order: sortOrder,
  };
}

export function emptyProductQuoteLine(sortOrder: number): ProductQuoteFormLineItem {
  return {
    key: crypto.randomUUID(),
    product_id: "",
    description: "",
    quantity: 1,
    unit_price: 0,
    sort_order: sortOrder,
  };
}

export function emptyQuoteForm(): QuoteFormState {
  return {
    client_id: "",
    opportunity_id: "",
    quote_type: "product",
    expiry_date: defaultQuoteExpiryDate(),
    bill_to_name: "",
    bill_to_address: "",
    notes: "",
    service_line_items: [],
    product_line_items: [],
  };
}

export function normalizeSalesQuoteListRow(row: SalesQuoteListRow): SalesQuoteListRow {
  return {
    ...row,
    subtotal: toNumber(row.subtotal),
    discount_amount: toNumber(row.discount_amount),
    total_amount: toNumber(row.total_amount),
    client: Array.isArray(row.client) ? row.client[0] ?? null : row.client ?? null,
  };
}

export function normalizeSalesQuoteHeader(row: SalesQuoteHeaderRow): SalesQuoteHeaderRow {
  return {
    ...row,
    subtotal: toNumber(row.subtotal),
    discount_amount: toNumber(row.discount_amount),
    total_amount: toNumber(row.total_amount),
  };
}

export function normalizeSalesQuoteLineItem(
  row: SalesQuoteLineItemRow,
): SalesQuoteLineItemRow {
  return {
    ...row,
    quantity: row.quantity == null ? null : toNumber(row.quantity),
    unit_price: row.unit_price == null ? null : toNumber(row.unit_price),
    labour_amount: toNumber(row.labour_amount),
    material_amount: toNumber(row.material_amount),
    discount_amount: toNumber(row.discount_amount),
    total_cost: toNumber(row.total_cost),
    product: Array.isArray(row.product) ? row.product[0] ?? null : row.product ?? null,
  };
}

export function quoteHeaderToFormState(
  quote: SalesQuoteHeaderRow,
  lineItems: SalesQuoteLineItemRow[],
): QuoteFormState {
  if (quote.quote_type === "product") {
    return {
      client_id: quote.client_id,
      opportunity_id: quote.opportunity_id ?? "",
      quote_type: "product",
      expiry_date: quote.expiry_date?.slice(0, 10) ?? defaultQuoteExpiryDate(),
      bill_to_name: quote.bill_to_name,
      bill_to_address: quote.bill_to_address ?? "",
      notes: quote.notes ?? "",
      service_line_items: [],
      product_line_items: lineItems.map((line, index) => ({
        key: line.id,
        product_id: line.product_id ?? "",
        description: line.description,
        quantity: toNumber(line.quantity),
        unit_price: toNumber(line.unit_price),
        sort_order: line.sort_order ?? index,
      })),
    };
  }

  return {
    client_id: quote.client_id,
    opportunity_id: quote.opportunity_id ?? "",
    quote_type: "service",
    expiry_date: quote.expiry_date?.slice(0, 10) ?? defaultQuoteExpiryDate(),
    bill_to_name: quote.bill_to_name,
    bill_to_address: quote.bill_to_address ?? "",
    notes: quote.notes ?? "",
    service_line_items: lineItems.map((line, index) => ({
      key: line.id,
      site_id: line.site_id,
      category_label: line.category_label ?? "",
      description: line.description,
      labour_amount: toNumber(line.labour_amount),
      material_amount: toNumber(line.material_amount),
      discount_amount: toNumber(line.discount_amount),
      sort_order: line.sort_order ?? index,
    })),
    product_line_items: [],
  };
}

export function quoteLineItemsToInvoiceFormLines(
  lineItems: SalesQuoteLineItemRow[],
) {
  return lineItems.map((line, index) => ({
    key: line.id,
    site_id: line.site_id,
    category_label: line.category_label ?? "",
    description: line.description,
    labour_amount: toNumber(line.labour_amount),
    material_amount: toNumber(line.material_amount),
    discount_amount: toNumber(line.discount_amount),
    taxed: true,
    sort_order: line.sort_order ?? index,
  }));
}

export function getClientName(
  clients: Array<{ client_id: string; client_name: string }>,
  clientId: string | null | undefined,
): string {
  if (!clientId) return "—";
  return (
    clients.find((client) => client.client_id === clientId)?.client_name ??
    clientId
  );
}

export async function recordQuoteSaleConversions(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  quoteId: string,
  incomeIds: string[],
) {
  for (const incomeRegisterId of incomeIds) {
    const { error } = await supabase.rpc("record_quote_sale_conversion", {
      p_quote_id: quoteId,
      p_income_register_id: incomeRegisterId,
    });
    if (error) {
      throw error;
    }
  }
}
