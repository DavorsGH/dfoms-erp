import { toNumber } from "@/utils/client-invoices-types";

export type RecordProductSalePaymentBody = {
  payment_date: string;
  amount: number;
  payment_method?: string | null;
  notes?: string | null;
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

  return null;
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
