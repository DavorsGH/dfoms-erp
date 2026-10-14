import {
  computePurchaseTaxAmounts,
  roundTaxAmount,
} from "./tax-utils";

/** Parameters passed to save_accounts_payable that reflect bill financials (excl. tenant, id, source_type, tax_rows, source_id). */
export const ACCOUNTS_PAYABLE_SAVE_RPC_FINANCIAL_PARAMS = [
  "p_business_unit_id",
  "p_vendor_name",
  "p_invoice_number",
  "p_expense_category",
  "p_sub_category",
  "p_description",
  "p_invoice_date",
  "p_due_date",
  "p_amount",
  "p_amount_paid",
  "p_balance_due",
  "p_status",
  "p_gross_before_wht",
  "p_wht_rate",
  "p_wht_amount",
  "p_input_vat_amount",
  "p_net_of_tax_amount",
  "p_notes",
] as const;

export type AccountsPayableEditFormFinancialInput = {
  vendorName: string;
  invoice_number: string;
  expense_category: string;
  sub_category: string;
  description: string;
  invoice_date: string;
  due_date: string;
  amountGrossBeforeWht: string;
  wht_rate: string;
  wht_amount: string;
  input_vat_amount: string;
  notes: string;
};

type AccountsPayableRpcFinancialComparable = {
  business_unit_id: string | null;
  vendor_name: string;
  invoice_number: string;
  expense_category: string;
  sub_category: string;
  description: string | null;
  invoice_date: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  balance_due: number;
  status: string;
  gross_before_wht: number;
  wht_rate: number | null;
  wht_amount: number;
  input_vat_amount: number;
  net_of_tax_amount: number;
  notes: string | null;
};

function normalizeApTextField(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function normalizeApNullableText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeApDateField(value: string | null | undefined): string {
  if (!value?.trim()) {
    return "";
  }
  return value.trim().slice(0, 10);
}

function buildAccountsPayableRpcFinancialComparable(
  input: AccountsPayableEditFormFinancialInput,
  options: {
    amountPaid: number;
    businessUnitId: string | null;
  },
): AccountsPayableRpcFinancialComparable {
  const grossBeforeWht = Number(input.amountGrossBeforeWht) || 0;
  const whtRate = Number(input.wht_rate) || 0;
  const whtAmount = Math.max(
    0,
    roundTaxAmount(Number(input.wht_amount) || 0),
  );
  const inputVatAmount = Math.max(
    0,
    roundTaxAmount(Number(input.input_vat_amount) || 0),
  );
  const purchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht,
    whtRatePct: whtRate,
    whtAmount,
    inputVatAmount,
  });
  const amountPaid = options.amountPaid;
  const balanceDue = calculateBalanceDue(
    purchaseTax.netPaidToSupplier,
    amountPaid,
  );
  const daysOutstanding = calculateDaysOutstanding(input.due_date);

  return {
    business_unit_id: options.businessUnitId,
    vendor_name: normalizeApTextField(input.vendorName),
    invoice_number: normalizeApTextField(input.invoice_number),
    expense_category: normalizeApTextField(input.expense_category),
    sub_category: normalizeApTextField(input.sub_category),
    description: normalizeApNullableText(input.description),
    invoice_date: normalizeApDateField(input.invoice_date),
    due_date: normalizeApDateField(input.due_date),
    amount: purchaseTax.netPaidToSupplier,
    amount_paid: amountPaid,
    balance_due: balanceDue,
    status: calculateStatus(balanceDue, daysOutstanding),
    gross_before_wht: purchaseTax.grossBeforeWht,
    wht_rate: whtRate > 0 ? whtRate : null,
    wht_amount: purchaseTax.whtAmount,
    input_vat_amount: purchaseTax.inputVatAmount,
    net_of_tax_amount: purchaseTax.netOfTaxAmount,
    notes: normalizeApNullableText(input.notes),
  };
}

function buildAccountsPayableRpcFinancialComparableFromEntry(
  entry: AccountsPayableEntry,
): AccountsPayableRpcFinancialComparable {
  const grossBeforeWht = getPayableGrossBeforeWht(entry);
  const whtRate = Number(entry.wht_rate) || 0;
  const whtAmount = Math.max(0, roundTaxAmount(Number(entry.wht_amount) || 0));
  const inputVatAmount = Math.max(
    0,
    roundTaxAmount(Number(entry.input_vat_amount) || 0),
  );
  const purchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht,
    whtRatePct: whtRate,
    whtAmount,
    inputVatAmount,
  });
  const amountPaid = entry.amount_paid ?? 0;
  const balanceDue = calculateBalanceDue(
    purchaseTax.netPaidToSupplier,
    amountPaid,
  );
  const dueDate = normalizeApDateField(entry.due_date);
  const daysOutstanding = dueDate
    ? calculateDaysOutstanding(dueDate)
    : 0;

  return {
    business_unit_id: entry.business_unit_id ?? null,
    vendor_name: normalizeApTextField(entry.vendor_name),
    invoice_number: normalizeApTextField(entry.invoice_number),
    expense_category: normalizeApTextField(entry.expense_category),
    sub_category: normalizeApTextField(entry.sub_category),
    description: normalizeApNullableText(entry.description),
    invoice_date: normalizeApDateField(entry.invoice_date),
    due_date: dueDate,
    amount: purchaseTax.netPaidToSupplier,
    amount_paid: amountPaid,
    balance_due: balanceDue,
    status: calculateStatus(balanceDue, daysOutstanding),
    gross_before_wht: purchaseTax.grossBeforeWht,
    wht_rate: whtRate > 0 ? whtRate : null,
    wht_amount: purchaseTax.whtAmount,
    input_vat_amount: purchaseTax.inputVatAmount,
    net_of_tax_amount: purchaseTax.netOfTaxAmount,
    notes: normalizeApNullableText(entry.notes),
  };
}

function rpcFinancialComparablesEqual(
  left: AccountsPayableRpcFinancialComparable,
  right: AccountsPayableRpcFinancialComparable,
): boolean {
  return (
    left.business_unit_id === right.business_unit_id &&
    left.vendor_name === right.vendor_name &&
    left.invoice_number === right.invoice_number &&
    left.expense_category === right.expense_category &&
    left.sub_category === right.sub_category &&
    left.description === right.description &&
    left.invoice_date === right.invoice_date &&
    left.due_date === right.due_date &&
    left.amount === right.amount &&
    left.amount_paid === right.amount_paid &&
    left.balance_due === right.balance_due &&
    left.status === right.status &&
    left.gross_before_wht === right.gross_before_wht &&
    left.wht_rate === right.wht_rate &&
    left.wht_amount === right.wht_amount &&
    left.input_vat_amount === right.input_vat_amount &&
    left.net_of_tax_amount === right.net_of_tax_amount &&
    left.notes === right.notes
  );
}

/** True when edit form financials match what save_accounts_payable would send (project_id excluded). */
export function accountsPayableEditFinancialFieldsUnchanged(
  form: AccountsPayableEditFormFinancialInput,
  entry: AccountsPayableEntry,
): boolean {
  const fromForm = buildAccountsPayableRpcFinancialComparable(form, {
    amountPaid: entry.amount_paid ?? 0,
    businessUnitId: entry.business_unit_id ?? null,
  });
  const fromEntry = buildAccountsPayableRpcFinancialComparableFromEntry(entry);
  return rpcFinancialComparablesEqual(fromForm, fromEntry);
}

export type AccountsPayableEntry = {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  expense_category: string | null;
  sub_category: string | null;
  description: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number;
  amount_paid: number;
  balance_due: number | null;
  status: string | null;
  notes: string | null;
  net_of_tax_amount?: number | null;
  input_vat_amount?: number | null;
  wht_rate?: number | null;
  wht_amount?: number | null;
  gross_before_wht?: number | null;
  business_unit_id?: string | null;
  project_id?: string | null;
  /** Present when linked to fixed_assets credit purchase (exclude from AP accrual). */
  source_type?: string | null;
  source_id?: string | null;
};

/** save_accounts_payable returns jsonb `{ id, accrualStatus, ... }`. */
export function resolveAccountsPayableIdFromSaveRpc(
  data: unknown,
  editingId: string | null,
): string | null {
  if (editingId) {
    return editingId;
  }
  if (typeof data === "object" && data && "id" in data) {
    const id = (data as { id: unknown }).id;
    if (typeof id === "string" && id.trim()) {
      return id.trim();
    }
  }
  return null;
}

export type PayableStatus = "Paid" | "Overdue" | "Outstanding";

export type AccountsPayablePaymentSource = "company_cash" | "directors_loan";

export type AccountsPayablePaymentRecord = {
  id: string;
  tenant_id: string;
  accounts_payable_id: string;
  payment_date: string | null;
  amount: number;
  payment_source: AccountsPayablePaymentSource | null;
  notes: string | null;
};

export function formatPaymentSourceLabel(
  source: AccountsPayablePaymentSource | null | undefined,
): string {
  if (source === "directors_loan") {
    return "Director (personal)";
  }
  if (source === "company_cash") {
    return "Company cash";
  }
  return "—";
}

export function formatAccountsPayableDrawerSubtitle(
  entry: Pick<AccountsPayableEntry, "vendor_name" | "invoice_number">,
): string {
  const vendor = entry.vendor_name?.trim() || "—";
  const invoice = entry.invoice_number?.trim();
  return invoice ? `${vendor} — ${invoice}` : vendor;
}

export function formatPayableDateDisplay(
  value: string | null | undefined,
): string {
  if (!value?.trim()) {
    return "—";
  }
  return formatDate(value);
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

export function calculateDaysOutstandingOptional(
  dueDate: string | null | undefined,
  referenceDate = new Date(),
): number | null {
  if (!dueDate?.trim()) {
    return null;
  }
  return calculateDaysOutstanding(dueDate, referenceDate);
}

export function resolvePayableStatusLabel(
  entry: Pick<AccountsPayableEntry, "due_date">,
  balanceDue: number,
): PayableStatus | "—" {
  const daysOutstanding = calculateDaysOutstandingOptional(entry.due_date);
  if (daysOutstanding == null) {
    if (balanceDue === 0) {
      return "Paid";
    }
    return "—";
  }
  return calculateStatus(balanceDue, daysOutstanding);
}

export function normalizeAccountsPayablePaymentRecord(
  raw: AccountsPayablePaymentRecord,
): AccountsPayablePaymentRecord {
  const paymentDate = raw.payment_date?.trim()
    ? raw.payment_date.slice(0, 10)
    : null;
  const source =
    raw.payment_source === "directors_loan" ||
    raw.payment_source === "company_cash"
      ? raw.payment_source
      : null;

  return {
    ...raw,
    payment_date: paymentDate,
    amount: Number(raw.amount) || 0,
    payment_source: source,
    notes: raw.notes ?? null,
  };
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
