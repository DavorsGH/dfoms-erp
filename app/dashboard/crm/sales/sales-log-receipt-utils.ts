import type { ClientEntry } from "../../operations/clients-utils";
import { getIncomeCustomerDisplayName } from "../../finance/income-register-utils";
import type { PosReceiptData } from "../../pos/pos-receipt";
import {
  cartTotal,
  roundMoney,
  type PosCartLine,
} from "../../pos/pos-utils";
import {
  normalizeProductSaleEntry,
  PRODUCT_SALES_SELECT,
  type ProductSaleEntry,
} from "../product-sales-utils";
import { buildProductSaleReceiptData } from "../product-sale-receipt";
import type { CrmSaleEntry } from "./sales-utils";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SalesLogReceiptKind = "pos" | "product_sale" | "unsupported";

export function isPosInvoiceNo(invoiceNo: string | null | undefined): boolean {
  return /-POS-/i.test(invoiceNo?.trim() ?? "");
}

export function isProductSaleInvoiceNo(
  invoiceNo: string | null | undefined,
): boolean {
  return /-PSI-/i.test(invoiceNo?.trim() ?? "");
}

export function getSalesLogReceiptKind(sale: CrmSaleEntry): SalesLogReceiptKind {
  if (sale.source === "webhook") {
    return "unsupported";
  }

  const invoiceNo = sale.invoice_no?.trim() ?? "";
  if (!invoiceNo) {
    return "unsupported";
  }

  if (isPosInvoiceNo(invoiceNo)) {
    return "pos";
  }

  if (isProductSaleInvoiceNo(invoiceNo)) {
    return "product_sale";
  }

  return sale.source === "product_sale" ? "product_sale" : "unsupported";
}

export function parsePosPaymentMethodFromNotes(
  notes: string | null | undefined,
): string {
  const trimmed = notes?.trim() ?? "";
  if (!trimmed) {
    return "—";
  }

  const match = trimmed.match(/^Payment method:\s*(.+)$/m);
  return match?.[1]?.trim() || "—";
}

export function buildPosReceiptFromProductSaleEntries(
  entries: ProductSaleEntry[],
  clients: ClientEntry[] = [],
): PosReceiptData {
  const normalized = entries.map(normalizeProductSaleEntry);
  const sorted = [...normalized].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const first = sorted[0];
  if (!first) {
    throw new Error("No product sale lines found for this POS receipt.");
  }

  const lines: PosCartLine[] = sorted.map((entry, index) => ({
    id: entry.id,
    productId: entry.product_id ?? `line-${index}`,
    productCode: entry.product?.product_code ?? "—",
    productName: entry.product?.product_name ?? "—",
    unitOfMeasure: entry.product?.unit_of_measure ?? "",
    quantity: entry.sale_quantity ?? 0,
    unitPrice: entry.unit_price ?? 0,
    availableStock: 0,
  }));

  const amountReceived = roundMoney(
    sorted.reduce((sum, entry) => sum + (Number(entry.amount_received) || 0), 0),
  );

  return {
    invoiceNo: first.invoice_no,
    saleDate: first.date,
    customerLabel: getIncomeCustomerDisplayName(first, clients),
    paymentMethod: parsePosPaymentMethodFromNotes(first.notes),
    paymentStatus: first.payment_status,
    amountReceived,
    cartTotal: cartTotal(lines),
    lines,
  };
}

async function loadProductSaleRows(
  supabase: SupabaseClient,
  filter:
    | { kind: "id"; id: string }
    | { kind: "invoice_no"; invoiceNo: string },
): Promise<ProductSaleEntry[]> {
  let query = supabase
    .from("income_register")
    .select(PRODUCT_SALES_SELECT)
    .eq("entry_type", "product_sale");

  if (filter.kind === "id") {
    query = query.eq("id", filter.id);
  } else {
    query = query.eq("invoice_no", filter.invoiceNo);
  }

  const { data, error } = await query.order("id", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }

  return ((data as ProductSaleEntry[] | null) ?? []).map(normalizeProductSaleEntry);
}

export async function loadSalesLogReceiptData(
  supabase: SupabaseClient,
  sale: CrmSaleEntry,
  clients: ClientEntry[] = [],
):
  Promise<
    | { kind: "pos"; receipt: PosReceiptData }
    | { kind: "product_sale"; receipt: ReturnType<typeof buildProductSaleReceiptData> }
    | { kind: "unsupported"; reason: string }
  > {
  const receiptKind = getSalesLogReceiptKind(sale);
  if (receiptKind === "unsupported") {
    return {
      kind: "unsupported",
      reason:
        sale.source === "webhook"
          ? "Webhook-recorded digital sales do not have a receipt template yet."
          : "This sale does not have a printable receipt.",
    };
  }

  if (receiptKind === "pos") {
    const invoiceNo = sale.invoice_no?.trim();
    if (!invoiceNo) {
      return {
        kind: "unsupported",
        reason: "POS sale is missing a receipt number.",
      };
    }

    const rows = await loadProductSaleRows(supabase, {
      kind: "invoice_no",
      invoiceNo,
    });
    if (rows.length === 0) {
      return {
        kind: "unsupported",
        reason: "Could not find POS sale lines for this receipt number.",
      };
    }

    return {
      kind: "pos",
      receipt: buildPosReceiptFromProductSaleEntries(rows, clients),
    };
  }

  const rows = await loadProductSaleRows(supabase, { kind: "id", id: sale.id });
  const entry = rows[0];
  if (!entry) {
    return {
      kind: "unsupported",
      reason: "Could not find this product sale.",
    };
  }

  return {
    kind: "product_sale",
    receipt: buildProductSaleReceiptData(entry, clients),
  };
}