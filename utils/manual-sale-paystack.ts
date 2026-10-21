/** Client-safe helpers for manual-sale Paystack collection. */

export const MANUAL_SALE_PAYSTACK_METHODS = ["Mobile Money", "Card"] as const;

export const AWAITING_PAYMENT_LABEL = "Awaiting payment";

export const SALES_REGISTER_CANCELLED_STATUS = "Cancelled";

export type ManualSaleCollectionMode = "received" | "paystack";

export type PaystackChargeChannel = "card" | "mobile_money";

export type ManualSaleSnapshotMeta = {
  salesRepId: string | null;
  paymentMethod: string;
  amountToCollect: number;
};

/** Cart JSON stored on product_sale_payment_requests for a charge-first manual sale. */
export type ManualSaleCartSnapshot = {
  saleDate?: string;
  clientId?: string | null;
  customerName?: string | null;
  notes?: string | null;
  dueDate?: string;
  businessUnitId?: string | null;
  lines?: Array<{
    productId?: string;
    productName?: string;
    quantity?: number;
    unitPrice?: number;
  }>;
  /** Optional. Older requests stored this under manualSale instead. */
  salesRepId?: string | null;
  /** Older charge-first requests. New requests do not need this key. */
  manualSale?: ManualSaleSnapshotMeta | null;
};

export type OpenPaystackPaymentRequest = {
  id: string;
  invoice_no: string;
  amount_requested: number;
  status: string;
  payment_method: string;
  income_ids: string[];
  cart_snapshot: ManualSaleCartSnapshot | null;
  created_at: string;
};

export function isPaystackCollectMethod(method: string | null | undefined): boolean {
  const trimmed = (method ?? "").trim();
  return (MANUAL_SALE_PAYSTACK_METHODS as readonly string[]).includes(trimmed);
}

export function manualSalePaymentMethodRequired(amountPaidNow: number): boolean {
  return Number(amountPaidNow) > 0;
}

/** Charge exactly the amount taken now, never more than the sale total. */
export function manualSalePaystackChargeAmount(
  saleTotal: number,
  amountPaidNow: number,
): number | null {
  const total = Math.round((Number(saleTotal) || 0) * 100) / 100;
  const paid = Math.round((Number(amountPaidNow) || 0) * 100) / 100;
  if (!Number.isFinite(paid) || paid <= 0) {
    return null;
  }
  if (paid > total + 0.001) {
    return null;
  }
  return paid;
}

export function paystackChannelsForMethod(
  method: string | null | undefined,
): PaystackChargeChannel[] {
  const trimmed = (method ?? "").trim();
  if (/card/i.test(trimmed)) {
    return ["card"];
  }
  if (/mobile|momo/i.test(trimmed)) {
    return ["mobile_money"];
  }
  return ["card", "mobile_money"];
}

const PAYSTACK_REF_LINE = /^Paystack ref:\s*(\S+)/im;
const TRANSACTION_REF_LINE = /^Transaction ref:\s*(.+)$/im;

export function notesWithTransactionReference(
  notes: string | null | undefined,
  reference: string | null | undefined,
): string | null {
  const ref = (reference ?? "").trim();
  const base = (notes ?? "").trim();
  if (!ref) {
    return base || null;
  }
  if (TRANSACTION_REF_LINE.test(base) || PAYSTACK_REF_LINE.test(base)) {
    return base;
  }
  const line = `Transaction ref: ${ref}`;
  return base ? `${base}\n${line}` : line;
}

/**
 * A charge-first manual sale has no income rows yet and at least one cart line.
 * POS till carts stay out of this path: they use a provisional invoice and do not
 * store salesRepId. Older manual requests are recognised by manualSale.
 */
export function isManualSalePaystackSnapshot(input: {
  incomeIds?: string[] | null;
  invoiceNo?: string | null;
  snapshot:
    | (Pick<ManualSaleCartSnapshot, "lines" | "salesRepId" | "manualSale"> &
        object)
    | null;
}): boolean {
  const incomeIds = (input.incomeIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (incomeIds.length > 0) {
    return false;
  }
  const lines = input.snapshot?.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    return false;
  }
  if (input.snapshot && Object.prototype.hasOwnProperty.call(input.snapshot, "salesRepId")) {
    return true;
  }
  if (input.snapshot?.manualSale) {
    return true;
  }
  const invoiceNo = (input.invoiceNo ?? "").trim();
  if (
    !invoiceNo ||
    invoiceNo.startsWith("MOMO-PENDING-") ||
    invoiceNo.startsWith("LINK-PENDING-")
  ) {
    return false;
  }
  return true;
}

/** Income notes written by apply_product_sale_paystack_payment: one fact per line. */
export function paystackSaleIncomeNotes(
  notes: string | null | undefined,
  paymentMethod: string,
  reference: string,
): string {
  const base = notes?.trim() ?? "";
  const method = paymentMethod.trim() || "Paystack";
  const ref = reference.trim();
  return [base, `Payment method: ${method}`, ref ? `Paystack ref: ${ref}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function paystackOverpaymentReason(
  unallocated: number,
  invoiceNo: string,
): string {
  const amount = Math.round((Number(unallocated) || 0) * 100) / 100;
  return `Customer paid GHS ${amount.toFixed(2)} more than was owed on ${invoiceNo}`;
}

/** RAISE EXCEPTION text, without an ERROR: prefix or a CONTEXT/DETAIL trailer. */
export function paystackApplyErrorReason(message: string): string {
  let text = message.trim().replace(/^(?:ERROR|error):\s*/, "");
  const trailer = text.search(/\n(?:CONTEXT|DETAIL|HINT):/);
  if (trailer >= 0) {
    text = text.slice(0, trailer);
  }
  return text.trim();
}

export function notesWithPaystackReference(
  notes: string | null | undefined,
  reference: string | null | undefined,
): string | null {
  const ref = (reference ?? "").trim();
  const base = (notes ?? "").trim();
  if (!ref) {
    return base || null;
  }
  if (PAYSTACK_REF_LINE.test(base)) {
    return base;
  }
  const line = `Paystack ref: ${ref}`;
  return base ? `${base}\n${line}` : line;
}

/**
 * Receipt tender line. Paystack charges read "Paid via Paystack (Mobile Money) · ref XXXX".
 * An already-received reference is appended as "Mobile Money · ref XXXX".
 */
export function formatReceiptPaymentMethodLine(
  method: string,
  notes: string | null | undefined,
): string {
  const tender = method.trim();
  if (!tender) {
    return tender;
  }
  const paystackRef = notes?.match(PAYSTACK_REF_LINE)?.[1]?.trim();
  if (paystackRef) {
    return `Paid via Paystack (${tender}) · ref ${paystackRef}`;
  }
  const transactionRef = notes?.match(TRANSACTION_REF_LINE)?.[1]?.trim();
  if (transactionRef) {
    return `${tender} · ref ${transactionRef}`;
  }
  return tender;
}
