import type { SupabaseClient } from "@supabase/supabase-js";
import { STAMP_REFUSED_VIEW_ALL_MESSAGE } from "@/utils/business-unit-view";
import {
  getProductSaleProductLabel,
  normalizeProductSaleEntry,
  PRODUCT_SALES_SELECT,
  type ProductSaleEntry,
} from "./product-sales-utils";
import { todayIsoDate } from "@/utils/product-sale-payments-types";

export type ProductReturnDisposition = "restock" | "writeoff";

export type ProductReturnOutcome = "refund_now" | "store_credit" | "exchange_hold";

export type ProductReturnReceiptLine = {
  incomeRegisterId: string;
  productId: string;
  productLabel: string;
  unitOfMeasure: string | null;
  quantitySold: number;
  quantityAlreadyReturned: number;
  quantityRemaining: number;
  unitPrice: number;
  returnQuantity: number;
  disposition: ProductReturnDisposition;
};

export type ProductReturnRpcResult = {
  credit_note_id: string;
  credit_note_number: string;
  return_income_ids?: string[];
  refund_id?: string | null;
};

export const PRODUCT_RETURN_EXPLAINER =
  "Use Cancel sale only for a sale entered by mistake. Use Return when a customer brings goods back.";

export const PRODUCT_SALE_FULLY_RETURNED_CANCEL_TOOLTIP =
  "This sale has been fully returned. Nothing left to cancel.";

export const PRODUCT_SALE_PARTLY_RETURNED_CANCEL_TOOLTIP =
  "This sale is partly returned. Return the remaining items instead of cancelling the sale.";

export function isSaleLineFullyReturned(
  saleQuantity: number,
  returnedQuantity: number,
): boolean {
  const sold = Number(saleQuantity) || 0;
  const returned = Number(returnedQuantity) || 0;
  return returned > 0.0001 && returned + 0.0001 >= sold;
}

export function resolveProductSaleCancelBlockReason(args: {
  saleQuantity: number;
  returnedQuantity: number;
}): string | null {
  const sold = Number(args.saleQuantity) || 0;
  const returned = Number(args.returnedQuantity) || 0;
  if (returned <= 0.0001) {
    return null;
  }
  if (isSaleLineFullyReturned(sold, returned)) {
    return PRODUCT_SALE_FULLY_RETURNED_CANCEL_TOOLTIP;
  }
  return PRODUCT_SALE_PARTLY_RETURNED_CANCEL_TOOLTIP;
}

export function isProductSaleReturn(
  entry: Pick<ProductSaleEntry, "is_sale_return">,
): boolean {
  return entry.is_sale_return === true;
}

export function getCreditNoteNumberFromEntry(
  entry: Pick<ProductSaleEntry, "credit_note">,
): string | null {
  const note = Array.isArray(entry.credit_note)
    ? entry.credit_note[0]
    : entry.credit_note;
  const num = note?.credit_note_number?.trim();
  return num || null;
}

export function productReturnRequiresScopedBuMessage(unitLabel: string): string {
  return `Select ${unitLabel} in the business unit switcher before processing this return. All Businesses is view-only and cannot post returns.`;
}

export function saleMissingBusinessUnitTagMessage(): string {
  return "This sale has no business unit tag. Select the business unit where it was sold, then try again.";
}

export function tenantHasConfiguredBusinessUnits(
  units: { id: string; name: string }[],
): boolean {
  return units.length > 0;
}

export function resolveBusinessUnitLabel(
  businessUnitId: string | null,
  units: { id: string; name: string }[],
): string {
  if (!businessUnitId) {
    return "your workspace default";
  }
  const match = units.find((unit) => unit.id === businessUnitId);
  return match?.name ?? "the business unit where this sale was recorded";
}

export function evaluateReturnBusinessUnitGate(args: {
  viewAllBusinessUnits: boolean;
  activeBusinessUnitId: string | null;
  saleBusinessUnitId: string | null;
  units: { id: string; name: string }[];
}):
  | { ok: true }
  | { ok: false; message: string } {
  const tenantUsesBusinessUnits = tenantHasConfiguredBusinessUnits(args.units);

  if (args.viewAllBusinessUnits) {
    return {
      ok: false,
      message: productReturnRequiresScopedBuMessage(
        resolveBusinessUnitLabel(args.saleBusinessUnitId, args.units),
      ),
    };
  }

  const saleBu = args.saleBusinessUnitId?.trim() || null;
  const activeBu = args.activeBusinessUnitId?.trim() || null;

  if (tenantUsesBusinessUnits && !saleBu) {
    return { ok: false, message: saleMissingBusinessUnitTagMessage() };
  }

  if (saleBu && activeBu && saleBu !== activeBu) {
    return {
      ok: false,
      message: productReturnRequiresScopedBuMessage(
        resolveBusinessUnitLabel(saleBu, args.units),
      ),
    };
  }

  if (saleBu && !activeBu) {
    return {
      ok: false,
      message: productReturnRequiresScopedBuMessage(
        resolveBusinessUnitLabel(saleBu, args.units),
      ),
    };
  }

  return { ok: true };
}

export function resolveProductReturnRpcBusinessUnitId(args: {
  saleBusinessUnitId: string | null;
  activeBusinessUnitId: string | null;
  units: { id: string; name: string }[];
}): string | null {
  const saleBu = args.saleBusinessUnitId?.trim() || null;
  if (saleBu) {
    return saleBu;
  }
  if (!tenantHasConfiguredBusinessUnits(args.units)) {
    return null;
  }
  return args.activeBusinessUnitId?.trim() || null;
}

export function formatProductReturnRpcError(raw: string | undefined | null): string {
  const message = (raw ?? "").trim();
  if (!message) {
    return "Unable to complete the return. Check quantities and try again.";
  }

  const lower = message.toLowerCase();

  if (
    lower.includes("dfoms-bu-view-all") ||
    lower.includes("assert_not_view_all") ||
    lower.includes("all businesses is view-only")
  ) {
    return "Select the business unit where this sale was recorded before processing a return.";
  }

  if (lower.includes("cannot return voided") || lower.includes("sale_status = 'voided'")) {
    return "This sale was cancelled and cannot be returned.";
  }

  if (
    lower.includes("exceeds remaining returnable") ||
    lower.includes("exceed remaining returnable")
  ) {
    return "Return quantity exceeds what is still returnable on one or more lines.";
  }

  if (lower.includes("business unit mismatch") || lower.includes("sale business unit")) {
    return "Switch to the business unit where this sale was recorded, then try again.";
  }

  if (lower.includes("tenant mismatch")) {
    return "This return does not belong to your current workspace.";
  }

  if (lower.includes("lines must be a non-empty")) {
    return "Enter a return quantity on at least one line.";
  }

  if (lower.includes("return quantity must be greater than zero")) {
    return "Each returned line needs a quantity greater than zero.";
  }

  if (message.includes("PGRST") || message.includes("SQLSTATE") || lower.includes("raise exception")) {
    return "Unable to complete the return. Verify quantities and your business unit selection.";
  }

  if (message.length > 160) {
    return "Unable to complete the return. Verify quantities and your business unit selection.";
  }

  return message;
}

export function formatVoidProductSaleRpcError(raw: string | undefined | null): string {
  const message = (raw ?? "").trim();
  const lower = message.toLowerCase();
  if (message.includes(PRODUCT_SALE_FULLY_RETURNED_CANCEL_TOOLTIP)) {
    return PRODUCT_SALE_FULLY_RETURNED_CANCEL_TOOLTIP;
  }
  if (message.includes(PRODUCT_SALE_PARTLY_RETURNED_CANCEL_TOOLTIP)) {
    return PRODUCT_SALE_PARTLY_RETURNED_CANCEL_TOOLTIP;
  }
  if (lower.includes("credit note") || lower.includes("credit_note")) {
    return "This sale has returns. Use Return instead.";
  }
  return formatProductReturnRpcError(raw);
}

export async function fetchIncomeIdsWithReturnCredits(
  supabase: SupabaseClient,
  incomeIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(incomeIds.filter(Boolean))];
  if (unique.length === 0) {
    return new Set();
  }

  const result = new Set<string>();
  const chunkSize = 80;

  for (let offset = 0; offset < unique.length; offset += chunkSize) {
    const chunk = unique.slice(offset, offset + chunkSize);
    const { data, error } = await supabase
      .from("credit_note_line_items")
      .select("source_income_register_id")
      .in("source_income_register_id", chunk);

    if (error) {
      continue;
    }

    for (const row of data ?? []) {
      const id = String(row.source_income_register_id ?? "").trim();
      if (id) {
        result.add(id);
      }
    }
  }

  return result;
}

async function sumPriorReturnedQty(
  supabase: SupabaseClient,
  incomeRegisterId: string,
  productId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("credit_note_line_items")
    .select("quantity")
    .eq("source_income_register_id", incomeRegisterId)
    .eq("product_id", productId);

  if (error) {
    return 0;
  }

  return (data ?? []).reduce(
    (sum, row) => sum + (Number(row.quantity) || 0),
    0,
  );
}

export async function loadProductReturnReceiptContext(
  supabase: SupabaseClient,
  args: { tenantId: string; invoiceNo: string },
): Promise<
  | {
      ok: true;
      invoiceNo: string;
      saleBusinessUnitId: string | null;
      clientId: string | null;
      lines: ProductReturnReceiptLine[];
    }
  | { ok: false; error: string }
> {
  const invoiceNo = args.invoiceNo.trim();
  if (!invoiceNo) {
    return { ok: false, error: "Invoice number is missing for this sale." };
  }

  const { data, error } = await supabase
    .from("income_register")
    .select(PRODUCT_SALES_SELECT)
    .eq("tenant_id", args.tenantId)
    .eq("entry_type", "product_sale")
    .eq("invoice_no", invoiceNo)
    .order("id", { ascending: true });

  if (error) {
    return { ok: false, error: formatProductReturnRpcError(error.message) };
  }

  const rows = ((data as ProductSaleEntry[] | null) ?? []).map((row) =>
    normalizeProductSaleEntry(row),
  );

  const saleLines = rows.filter(
    (row) => !isProductSaleReturn(row) && row.sale_status !== "voided",
  );

  if (saleLines.length === 0) {
    return {
      ok: false,
      error: "No active sale lines were found for this receipt.",
    };
  }

  if (saleLines.some((row) => row.sale_status === "voided")) {
    return { ok: false, error: "This sale was cancelled and cannot be returned." };
  }

  const saleBusinessUnitId = saleLines[0]?.business_unit_id ?? null;

  const lines: ProductReturnReceiptLine[] = [];

  for (const entry of saleLines) {
    if (!entry.product_id) {
      continue;
    }

    const quantitySold = Number(entry.sale_quantity) || 0;
    const prior = await sumPriorReturnedQty(
      supabase,
      entry.id,
      entry.product_id,
    );
    const quantityRemaining = Math.max(0, quantitySold - prior);

    lines.push({
      incomeRegisterId: entry.id,
      productId: entry.product_id,
      productLabel: getProductSaleProductLabel(entry),
      unitOfMeasure: entry.product?.unit_of_measure ?? null,
      quantitySold,
      quantityAlreadyReturned: prior,
      quantityRemaining,
      unitPrice: Number(entry.unit_price) || 0,
      returnQuantity: 0,
      disposition: "restock",
    });
  }

  if (lines.every((line) => line.quantityRemaining <= 0)) {
    return {
      ok: false,
      error: "Everything on this receipt has already been returned.",
    };
  }

  return {
    ok: true,
    invoiceNo,
    saleBusinessUnitId,
    clientId: saleLines[0]?.client_id ?? null,
    lines,
  };
}

export function productReturnOutcomeCustomerMessage(args: {
  outcome: ProductReturnOutcome;
  creditNoteNumber: string;
  hasClientId: boolean;
  refundMethod?: string;
}): { headline: string; detail: string; emphasizeCreditNote: boolean } {
  const number = args.creditNoteNumber.trim() || "Credit note issued";

  if (args.outcome === "refund_now") {
    const method = args.refundMethod?.trim() || "Cash";
    return {
      headline: `Credit note ${number} created.`,
      detail: `Refund recorded via ${method}.`,
      emphasizeCreditNote: false,
    };
  }

  if (args.outcome === "exchange_hold") {
    if (args.hasClientId) {
      return {
        headline: `Credit note ${number} created.`,
        detail: "Exchange credit is held for the customer's next sale.",
        emphasizeCreditNote: false,
      };
    }
    return {
      headline: `Credit note ${number}`,
      detail: `Walk-in customer: give them credit note number ${number}. They will need it to use this credit on their next purchase.`,
      emphasizeCreditNote: true,
    };
  }

  if (args.hasClientId) {
    return {
      headline: `Credit note ${number} created.`,
      detail: "Store credit added to the customer's account.",
      emphasizeCreditNote: false,
    };
  }

  return {
    headline: `Credit note ${number}`,
    detail: `Walk-in customer: give them credit note number ${number}. They will need it to use this credit.`,
    emphasizeCreditNote: true,
  };
}

export function buildProductReturnLinesPayload(
  lines: ProductReturnReceiptLine[],
): {
  income_register_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  disposition: ProductReturnDisposition;
}[] {
  return lines
    .filter((line) => line.returnQuantity > 0)
    .map((line) => ({
      income_register_id: line.incomeRegisterId,
      product_id: line.productId,
      quantity: line.returnQuantity,
      unit_price: line.unitPrice,
      disposition: line.disposition,
    }));
}

export function summarizeProductReturn(lines: ProductReturnReceiptLine[]): {
  totalValue: number;
  restockQty: number;
  writeoffQty: number;
} {
  let totalValue = 0;
  let restockQty = 0;
  let writeoffQty = 0;

  for (const line of lines) {
    const qty = line.returnQuantity;
    if (qty <= 0) {
      continue;
    }
    totalValue += qty * line.unitPrice;
    if (line.disposition === "writeoff") {
      writeoffQty += qty;
    } else {
      restockQty += qty;
    }
  }

  return { totalValue, restockQty, writeoffQty };
}

export function defaultProductReturnDate(): string {
  return todayIsoDate();
}

export function outcomeSuccessLabel(
  outcome: ProductReturnOutcome,
  refundMethod?: string,
): string {
  if (outcome === "refund_now") {
    const method = refundMethod?.trim() || "Cash";
    return `Refund recorded via ${method}.`;
  }
  if (outcome === "exchange_hold") {
    return "Exchange credit is held for the next sale.";
  }
  return "Store credit added to the customer account.";
}

export { STAMP_REFUSED_VIEW_ALL_MESSAGE };
