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
