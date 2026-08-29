import type { SupabaseClient } from "@supabase/supabase-js";
import { syncProductSaleVfrsTax } from "@/utils/product-sale-tax-sync";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import type { ClientEntry } from "../operations/clients-utils";
import { formatInventoryQuantity } from "../inventory/inventory-utils";

export type PosCartLine = {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  unitOfMeasure: string;
  quantity: number;
  unitPrice: number;
  availableStock: number;
};

export type PosCheckoutInput = {
  saleDate: string;
  /** Reuse a partially posted POS receipt number; omit/null to allocate server-side. */
  invoiceNo?: string | null;
  clientId: string | null;
  customerName: string | null;
  salesRepId?: string | null;
  paymentMethod: string;
  amountReceived: number;
  paymentStatus: string;
  dueDate: string;
  notes: string | null;
  cartLines: PosCartLine[];
  /** Create-only stamp; null = All Businesses. */
  businessUnitId?: string | null;
};

export type PosCheckoutLineResult = {
  lineId: string;
  productLabel: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  success: boolean;
  incomeId?: string;
  errorMessage?: string;
};

export type PosCheckoutRunSummary = {
  invoiceNo: string | null;
  succeeded: PosCheckoutLineResult[];
  failed: PosCheckoutLineResult[];
  stoppedEarly: boolean;
  /** Sale lines posted, but VFRS output tax / tax ledger sync failed. */
  taxSyncWarning?: string | null;
};

export const POS_PAYMENT_STATUS_OPTIONS = ["Pending", "Partial", "Paid", "Overdue"] as const;

/** Simplified POS methods — Card deferred until physical Terminal hardware. */
export const POS_CHECKOUT_PAYMENT_METHODS = ["Cash", "Mobile Money"] as const;

export const POS_MOMO_PAYMENT_METHOD = "Mobile Money";

export const POS_PRINT_AREA_ID = "pos-receipt-print-area";

const POS_INVOICE_ENTITY_TYPE = "POS";

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function lineSubtotal(line: Pick<PosCartLine, "quantity" | "unitPrice">): number {
  return roundMoney(line.quantity * line.unitPrice);
}

export function cartTotal(lines: PosCartLine[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + lineSubtotal(line), 0));
}

export function effectiveCartTotal(
  lines: PosCartLine[],
  promoDiscount = 0,
  loyaltyDiscount = 0,
): number {
  const gross = cartTotal(lines);
  const totalDiscount = roundMoney(
    Math.max(0, promoDiscount) + Math.max(0, loyaltyDiscount),
  );
  return roundMoney(Math.max(0, gross - totalDiscount));
}

export function buildPosCartLinesFromQuote(
  quoteLineItems: Array<{
    product_id: string | null;
    quantity: number | null;
    unit_price: number | null;
  }>,
  products: FinishedProductRecord[],
): PosCartLine[] {
  const lines: PosCartLine[] = [];

  for (const item of quoteLineItems) {
    if (!item.product_id) {
      continue;
    }

    const product = products.find((entry) => entry.id === item.product_id);
    if (!product) {
      continue;
    }

    const quantity = Number(item.quantity) || 0;
    if (quantity <= 0) {
      continue;
    }

    lines.push({
      id: crypto.randomUUID(),
      productId: product.id,
      productCode: product.product_code,
      productName: product.product_name,
      unitOfMeasure: product.unit_of_measure,
      quantity,
      unitPrice:
        item.unit_price != null
          ? Number(item.unit_price) || 0
          : product.standard_selling_price ?? 0,
      availableStock: product.current_stock,
    });
  }

  return lines;
}

export function cartQuantityForProduct(
  lines: PosCartLine[],
  productId: string,
  excludeLineId?: string,
): number {
  return lines
    .filter((line) => line.productId === productId && line.id !== excludeLineId)
    .reduce((sum, line) => sum + line.quantity, 0);
}

export function getAvailableStockForProduct(
  product: FinishedProductRecord,
  lines: PosCartLine[],
  excludeLineId?: string,
): number {
  const reserved = cartQuantityForProduct(lines, product.id, excludeLineId);
  return Math.max(0, product.current_stock - reserved);
}

export function formatProductOptionLabel(product: FinishedProductRecord): string {
  return `${product.product_code} — ${product.product_name} (${formatInventoryQuantity(product.current_stock)} ${product.unit_of_measure} in stock)`;
}

export const POS_CUSTOMER_OTHER_VALUE = "__other__";

export function resolvePosCustomerSelection(
  clientSelect: string,
  walkInName: string,
): { clientId: string | null; customerName: string | null } {
  const trimmedSelect = clientSelect.trim();
  if (!trimmedSelect) {
    return { clientId: null, customerName: null };
  }
  if (trimmedSelect === POS_CUSTOMER_OTHER_VALUE) {
    return {
      clientId: null,
      customerName: walkInName.trim() || null,
    };
  }
  return { clientId: trimmedSelect, customerName: null };
}

export function getCustomerDisplayName(
  clientId: string | null,
  customerName: string | null,
  clients: ClientEntry[],
): string {
  if (clientId) {
    return (
      clients.find((client) => client.client_id === clientId)?.client_name ??
      clientId
    );
  }

  return customerName?.trim() || "—";
}

export function buildPosNotes(
  paymentMethod: string,
  userNotes: string | null,
): string | null {
  const methodLine = `Payment method: ${paymentMethod.trim()}`;
  const trimmedNotes = userNotes?.trim() ?? "";

  if (!trimmedNotes) {
    return methodLine;
  }

  return `${methodLine}\n${trimmedNotes}`;
}

export function allocateLinePayments(
  lines: PosCartLine[],
  totalAmountReceived: number,
): number[] {
  let remaining = roundMoney(totalAmountReceived);

  return lines.map((line) => {
    const lineTotal = lineSubtotal(line);
    const lineReceived = roundMoney(Math.min(lineTotal, Math.max(remaining, 0)));
    remaining = roundMoney(remaining - lineReceived);
    return lineReceived;
  });
}

async function fetchIncomeInvoiceNumber(
  supabase: SupabaseClient,
  incomeId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("income_register")
    .select("invoice_no")
    .eq("id", incomeId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const invoiceNo = (data as { invoice_no?: string | null } | null)?.invoice_no;
  return invoiceNo?.trim() ? invoiceNo.trim() : null;
}

export async function runPosCheckout(
  supabase: SupabaseClient,
  input: PosCheckoutInput,
): Promise<PosCheckoutRunSummary> {
  const succeeded: PosCheckoutLineResult[] = [];
  const failed: PosCheckoutLineResult[] = [];
  const linePayments = allocateLinePayments(input.cartLines, input.amountReceived);
  const notes = buildPosNotes(input.paymentMethod, input.notes);
  let allocatedInvoiceNo = input.invoiceNo?.trim() || null;

  for (const [index, line] of input.cartLines.entries()) {
    const lineTotal = lineSubtotal(line);
    const productLabel = `${line.productCode} — ${line.productName}`;

    const { data, error } = await supabase.rpc("create_product_sale", {
      p_date: input.saleDate,
      // First line allocates via generate_next_code(..., 'POS', 4); later lines reuse.
      p_invoice_no: allocatedInvoiceNo,
      p_client_id: input.clientId,
      p_customer_name: input.clientId ? null : input.customerName,
      p_product_id: line.productId,
      p_quantity: line.quantity,
      p_unit_price: line.unitPrice,
      p_amount_received: linePayments[index] ?? 0,
      p_payment_status: input.paymentStatus,
      p_due_date: input.dueDate,
      p_description: null,
      p_notes: notes,
      p_invoice_entity_type: POS_INVOICE_ENTITY_TYPE,
      p_sales_rep_id: input.salesRepId?.trim() || null,
      p_business_unit_id: input.businessUnitId ?? null,
    });

    if (error) {
      failed.push({
        lineId: line.id,
        productLabel,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal,
        success: false,
        errorMessage: error.message,
      });

      return {
        invoiceNo: allocatedInvoiceNo,
        succeeded,
        failed,
        stoppedEarly: true,
        taxSyncWarning: await applyVfrsToSucceededLines(supabase, succeeded),
      };
    }

    const incomeId = (data as string | null) ?? undefined;
    if (!allocatedInvoiceNo && incomeId) {
      allocatedInvoiceNo = await fetchIncomeInvoiceNumber(supabase, incomeId);
    }

    succeeded.push({
      lineId: line.id,
      productLabel,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal,
      success: true,
      incomeId,
    });
  }

  return {
    invoiceNo: allocatedInvoiceNo,
    succeeded,
    failed,
    stoppedEarly: false,
    taxSyncWarning: await applyVfrsToSucceededLines(supabase, succeeded),
  };
}

/**
 * VFRS output tax + tax ledger for the lines that did post. Non-fatal: the
 * sale, stock, and COGS are already committed by create_product_sale, so a
 * tax sync problem is reported as a warning instead of failing the checkout.
 */
async function applyVfrsToSucceededLines(
  supabase: SupabaseClient,
  succeeded: PosCheckoutLineResult[],
): Promise<string | null> {
  const incomeIds = succeeded
    .map((line) => line.incomeId)
    .filter((id): id is string => Boolean(id));

  if (incomeIds.length === 0) {
    return null;
  }

  const { error } = await syncProductSaleVfrsTax(supabase, incomeIds);
  return error;
}
