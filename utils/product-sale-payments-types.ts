import { toNumber } from "@/utils/client-invoices-types";

/** Tender names the sales register and receipts already recognise. */
export const MANUAL_SALE_PAYMENT_METHODS = [
  "Cash",
  "Mobile Money",
  "Card",
  "Bank transfer",
] as const;

export type ManualSalePaymentMethod = (typeof MANUAL_SALE_PAYMENT_METHODS)[number];

export function isManualSalePaymentMethod(
  value: string | null | undefined,
): value is ManualSalePaymentMethod {
  return (MANUAL_SALE_PAYMENT_METHODS as readonly string[]).includes(
    (value ?? "").trim(),
  );
}

/** Same notes line POS checkout writes, kept when a method is already stored. */
export function notesWithPaymentMethod(
  notes: string | null | undefined,
  paymentMethod: string,
): string {
  const existing = notes?.trim() ?? "";
  if (/^Payment method:\s*\S/m.test(existing)) {
    return existing;
  }
  const line = `Payment method: ${paymentMethod.trim()}`;
  return existing ? `${line}\n${existing}` : line;
}

export type RecordProductSalePaymentBody = {
  payment_date: string;
  amount: number;
  payment_method?: string | null;
  notes?: string | null;
  transaction_reference?: string | null;
};

export type ProductSalePaymentRow = {
  id: string;
  tenant_id: string;
  income_id: string;
  payment_date: string;
  amount: number;
  payment_method: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
};

export const PRODUCT_SALE_PAYMENT_SELECT =
  "id, tenant_id, income_id, payment_date, amount, payment_method, notes, recorded_by, created_at" as const;

export function validateRecordProductSalePaymentBody(
  body: RecordProductSalePaymentBody,
): string | null {
  if (!body.payment_date?.trim()) {
    return "Payment date is required.";
  }

  const amount = toNumber(body.amount);
  if (amount <= 0) {
    return "Payment amount must be greater than zero.";
  }

  if (!isManualSalePaymentMethod(body.payment_method)) {
    return "Choose a payment method.";
  }

  return null;
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
