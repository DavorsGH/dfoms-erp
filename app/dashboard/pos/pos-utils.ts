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
  saleDate: string;
  /** Reuse a partially posted POS receipt number; omit/null to allocate server-side. */
  invoiceNo?: string | null;
  clientId: string | null;
  customerName: string | null;
  paymentMethod: string;
  amountReceived: number;
  paymentStatus: string;
  dueDate: string;
  notes: string | null;
  cartLines: PosCartLine[];
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
};

export const POS_PAYMENT_STATUS_OPTIONS = ["Pending", "Partial", "Paid", "Overdue"] as const;

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
  };
}
