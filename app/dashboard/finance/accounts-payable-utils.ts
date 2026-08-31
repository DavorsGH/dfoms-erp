export type AccountsPayableEntry = {
  id: string;
  vendor_name: string;
  invoice_number: string;
  expense_category: string;
  sub_category: string;
  description: string | null;
  invoice_date: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  balance_due: number | null;
  status: string;
  notes: string | null;
  net_of_tax_amount?: number | null;
  input_vat_amount?: number | null;
  wht_rate?: number | null;
  wht_amount?: number | null;
  gross_before_wht?: number | null;
  business_unit_id?: string | null;
  /** Present when linked to fixed_assets credit purchase (exclude from AP accrual). */
  source_type?: string | null;
  source_id?: string | null;
};

export type PayableStatus = "Paid" | "Overdue" | "Outstanding";

export type AccountsPayablePaymentSource = "company_cash" | "directors_loan";

export type AccountsPayablePaymentRecord = {
  id: string;
  tenant_id: string;
  accounts_payable_id: string;
  payment_date: string;
  amount: number;
  payment_source: AccountsPayablePaymentSource;
  notes: string | null;
};

export function formatPaymentSourceLabel(
  source: AccountsPayablePaymentSource,
): string {
  return source === "directors_loan"
    ? "Director (personal)"
    : "Company cash";
}

export function getRemainingPayableBalance(entry: {
  amount: number;
  amount_paid: number;
  balance_due?: number | null;
}): number {
  if (entry.balance_due != null) {
    return Math.max(Number(entry.balance_due) || 0, 0);
  }
  return Math.max((Number(entry.amount) || 0) - (Number(entry.amount_paid) || 0), 0);
}

function toNullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value) || 0;
}

export function normalizeAccountsPayableEntry(
  raw: AccountsPayableEntry,
): AccountsPayableEntry {
  return {
    ...raw,
    amount: Number(raw.amount) || 0,
    amount_paid: Number(raw.amount_paid) || 0,
    balance_due:
      raw.balance_due == null ? null : Number(raw.balance_due) || 0,
    net_of_tax_amount: toNullableNumber(raw.net_of_tax_amount),
    input_vat_amount: toNullableNumber(raw.input_vat_amount),
    wht_rate: toNullableNumber(raw.wht_rate),
    wht_amount: toNullableNumber(raw.wht_amount),
    gross_before_wht: toNullableNumber(raw.gross_before_wht),
  };
}

/**
 * Invoice gross before WHT for form edit. Prefer gross_before_wht; else amount
 * (legacy rows stored the gross in amount before tax fields existed).
 */
export function getPayableGrossBeforeWht(entry: {
  gross_before_wht?: number | null;
  amount: number;
}): number {
  if (entry.gross_before_wht != null && entry.gross_before_wht > 0) {
    return Number(entry.gross_before_wht) || 0;
  }

  return Number(entry.amount) || 0;
}

export function formatGHS(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function calculateBalanceDue(
  amount: number,
  amountPaid: number,
): number {
  return amount - amountPaid;
}

export function calculateDaysOutstanding(
  dueDate: string,
  referenceDate = new Date(),
): number {
  const due = new Date(dueDate);
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffMs = today.getTime() - dueDay.getTime();

  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function calculateStatus(
  balanceDue: number,
  daysOutstanding: number,
): PayableStatus {
  if (balanceDue === 0) {
    return "Paid";
  }

  if (daysOutstanding > 0 && balanceDue > 0) {
    return "Overdue";
  }

  return "Outstanding";
}
