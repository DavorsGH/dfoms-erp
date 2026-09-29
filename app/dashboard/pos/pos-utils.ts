import type { SupabaseClient } from "@supabase/supabase-js";
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
  tenantId: string;
  saleDate: string;
  clientId: string | null;
  customerName: string | null;
  salesRepId?: string | null;
  paymentMethod: string;
  amountReceived: number;
  paymentStatus: string;
  dueDate: string;
  notes: string | null;
  cartLines: PosCartLine[];
  businessUnitId?: string | null;
};

export type PosCheckoutRunSummary = {
  invoiceNo: string | null;
  incomeIds: string[];
  creditApplied?: number;
  cashRecorded?: number;
  cashTendered?: number;
  changeDue?: number;
  creditNoteId?: string | null;
  creditNoteNumber?: string | null;
  creditRemainingBalance?: number;
};

export const POS_PAYMENT_STATUS_OPTIONS = ["Pending", "Partial", "Paid", "Overdue"] as const;

/** Simplified POS methods — Card deferred until physical Terminal hardware. */
export const POS_CHECKOUT_PAYMENT_METHODS = ["Cash", "Mobile Money"] as const;

export const POS_MOMO_PAYMENT_METHOD = "Mobile Money";

export const POS_PRINT_AREA_ID = "pos-receipt-print-area";

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

  return mergePosCartLines(lines);
}

export function cartUnitPricesMatch(a: number, b: number): boolean {
  return Math.abs(roundMoney(a) - roundMoney(b)) < 0.0001;
}

export function mergePosCartLines(lines: PosCartLine[]): PosCartLine[] {
  const merged: PosCartLine[] = [];
  for (const line of lines) {
    const index = merged.findIndex(
      (entry) =>
        entry.productId === line.productId &&
        cartUnitPricesMatch(entry.unitPrice, line.unitPrice),
    );
    if (index >= 0) {
      const existing = merged[index]!;
      merged[index] = {
        ...existing,
        quantity: roundMoney(existing.quantity + line.quantity),
      };
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}

export type AddProductToPosCartResult =
  | { ok: true; lines: PosCartLine[] }
  | { ok: false; error: string };

export function tryAddProductToPosCart(
  current: PosCartLine[],
  product: FinishedProductRecord,
  quantityToAdd: number,
  unitPrice?: number,
  createLineId: () => string = () => crypto.randomUUID(),
): AddProductToPosCartResult {
  const price = roundMoney(unitPrice ?? product.standard_selling_price ?? 0);
  const qty = quantityToAdd;
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Invalid quantity." };
  }

  const matchIndex = current.findIndex(
    (line) =>
      line.productId === product.id && cartUnitPricesMatch(line.unitPrice, price),
  );

  if (matchIndex >= 0) {
    const existing = current[matchIndex]!;
    const nextQty = roundMoney(existing.quantity + qty);
    const available = getAvailableStockForProduct(product, current, existing.id);
    if (nextQty > available + 0.0001) {
      return {
        ok: false,
        error: `Only ${formatInventoryQuantity(available)} ${product.unit_of_measure} of ${product.product_name} available (including items already in cart).`,
      };
    }
    const lines = [...current];
    lines[matchIndex] = { ...existing, quantity: nextQty };
    return { ok: true, lines };
  }

  const available = getAvailableStockForProduct(product, current);
  if (qty > available + 0.0001) {
    return {
      ok: false,
      error: `No stock available for ${product.product_name}. Current stock: ${formatInventoryQuantity(product.current_stock)} ${product.unit_of_measure}.`,
    };
  }

  return {
    ok: true,
    lines: [
      ...current,
      {
        id: createLineId(),
        productId: product.id,
        productCode: product.product_code,
        productName: product.product_name,
        unitOfMeasure: product.unit_of_measure,
        quantity: qty,
        unitPrice: price,
        availableStock: product.current_stock,
      },
    ],
  };
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

/** Default customer-facing label when no customer is selected on POS. */
export const POS_WALK_IN_CUSTOMER_LABEL = "Walk-in Customer";

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

/** Customer name for the live POS customer display (always a non-empty string). */
export function resolvePosCustomerDisplayLabel(
  clientSelect: string,
  walkInName: string,
  clients: ClientEntry[],
): string {
  const { clientId, customerName } = resolvePosCustomerSelection(
    clientSelect,
    walkInName,
  );

  if (clientId) {
    return getCustomerDisplayName(clientId, null, clients);
  }

  return customerName?.trim() || POS_WALK_IN_CUSTOMER_LABEL;
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

export function buildCheckoutPosCartLinesPayload(cartLines: PosCartLine[]) {
  return cartLines.map((line) => ({
    product_id: line.productId,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    product_code: line.productCode,
    product_name: line.productName,
  }));
}

/** True when checkout_pos_cart failed on a specific cart line (atomic rollback). */
export function isPosCheckoutLineFailureMessage(message: string): boolean {
  return /^Checkout failed on line \d+ of \d+ /i.test(message.trim());
}

export type PosCheckoutWithStoreCreditInput = PosCheckoutInput & {
  creditNoteId: string;
  creditApplyAmount: number;
  /** Physical cash tendered (may exceed cash due; change returned by RPC). */
  cashTendered: number;
};

export async function runPosCheckoutWithStoreCredit(
  supabase: SupabaseClient,
  input: PosCheckoutWithStoreCreditInput,
): Promise<PosCheckoutRunSummary> {
  const { data, error } = await supabase.rpc("pos_checkout_with_store_credit", {
    p_tenant_id: input.tenantId,
    p_business_unit_id: input.businessUnitId ?? null,
    p_sale_date: input.saleDate,
    p_invoice_no: null,
    p_client_id: input.clientId,
    p_customer_name: input.clientId ? null : input.customerName,
    p_payment_status: input.paymentStatus,
    p_due_date: input.dueDate,
    p_notes: input.notes,
    p_payment_method: input.paymentMethod,
    p_sales_rep_id: input.salesRepId?.trim() || null,
    p_amount_received: input.cashTendered,
    p_lines: buildCheckoutPosCartLinesPayload(input.cartLines),
    p_payment_request_id: null,
    p_paid_amount: null,
    p_paystack_reference: null,
    p_paid_at: null,
    p_credit_note_id: input.creditNoteId,
    p_credit_apply_amount: input.creditApplyAmount,
  });

  if (error) {
    throw new Error(error.message);
  }

  const result = data as Record<string, unknown> | null;
  return {
    invoiceNo: String(result?.invoice_no ?? "").trim() || null,
    incomeIds: ((result?.income_ids as string[] | null) ?? []).filter(Boolean),
    creditApplied: Number(result?.credit_applied) || 0,
    cashRecorded: Number(result?.cash_recorded) || 0,
    cashTendered: Number(result?.cash_tendered) || 0,
    changeDue: Number(result?.change_due) || 0,
    creditNoteId: String(result?.credit_note_id ?? input.creditNoteId),
    creditNoteNumber: String(result?.credit_note_number ?? "").trim() || null,
    creditRemainingBalance: Number(result?.credit_remaining_balance) || 0,
  };
}

export async function runPosCheckout(
  supabase: SupabaseClient,
  input: PosCheckoutInput,
): Promise<PosCheckoutRunSummary> {
  const { data, error } = await supabase.rpc("checkout_pos_cart", {
    p_tenant_id: input.tenantId,
    p_business_unit_id: input.businessUnitId ?? null,
    p_sale_date: input.saleDate,
    p_invoice_no: null,
    p_client_id: input.clientId,
    p_customer_name: input.clientId ? null : input.customerName,
    p_payment_status: input.paymentStatus,
    p_due_date: input.dueDate,
    p_notes: input.notes,
    p_payment_method: input.paymentMethod,
    p_sales_rep_id: input.salesRepId?.trim() || null,
    p_amount_received: input.amountReceived,
    p_lines: buildCheckoutPosCartLinesPayload(input.cartLines),
    p_payment_request_id: null,
    p_paid_amount: null,
    p_paystack_reference: null,
    p_paid_at: null,
  });

  if (error) {
    throw new Error(error.message);
  }

  const result = data as {
    invoice_no?: string | null;
    income_ids?: string[] | null;
  } | null;

  return {
    invoiceNo: result?.invoice_no?.trim() || null,
    incomeIds: (result?.income_ids ?? []).filter(Boolean),
  };
}
