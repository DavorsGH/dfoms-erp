export type ExpenseRegisterEntry = {
  id: string;
  date: string;
  expense_category: string;
  sub_category: string;
  description: string | null;
  vendor: string;
  price: number;
  quantity: number;
  amount: number;
  payment_method: string;
  approved_by: string;
  receipt_no: string;
  payment_status: string;
  notes: string | null;
  net_of_tax_amount?: number | null;
  input_vat_amount?: number | null;
  wht_rate?: number | null;
  wht_amount?: number | null;
  gross_before_wht?: number | null;
  project_id?: string | null;
};

/** Manual expense receipts use generate_next_code(..., 'EXP', 4). */
export const EXPENSE_RECEIPT_ENTITY_TYPE = "EXP";

function toNullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value) || 0;
}

export function normalizeExpenseRegisterEntry(
  raw: ExpenseRegisterEntry,
): ExpenseRegisterEntry {
  return {
    ...raw,
    price: Number(raw.price) || 0,
    quantity: Number(raw.quantity) || 0,
    amount: Number(raw.amount) || 0,
    net_of_tax_amount: toNullableNumber(raw.net_of_tax_amount),
    input_vat_amount: toNullableNumber(raw.input_vat_amount),
    wht_rate: toNullableNumber(raw.wht_rate),
    wht_amount: toNullableNumber(raw.wht_amount),
    gross_before_wht: toNullableNumber(raw.gross_before_wht),
  };
}

/**
 * Gross invoice before WHT. Prefer the stored thin column; fall back to
 * price × quantity (the pre-tax line total the form still edits).
 */
export function getExpenseGrossBeforeWht(entry: {
  gross_before_wht?: number | null;
  price: number;
  quantity: number;
  amount: number;
}): number {
  if (entry.gross_before_wht != null && entry.gross_before_wht > 0) {
    return Number(entry.gross_before_wht) || 0;
  }

  const lineTotal = calculateAmount(entry.price, entry.quantity);
  return lineTotal > 0 ? lineTotal : Number(entry.amount) || 0;
}

export function formatGHS(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function calculateAmount(price: number, quantity: number): number {
  return price * quantity;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function normalizeOptionalReceiptNo(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}
