import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateLoanOutstanding } from "./hr-register-utils";
import {
  formatPeriodLabel,
  getPeriodEndDate,
  parsePeriodKey,
  payrollMonthToPeriodKey,
} from "./payroll-period-utils";
import type { PayrollProcessingRow } from "./payroll-processing-utils";

export const PAYROLL_EXPENSE_AUTO_DESCRIPTION_PREFIX =
  "Auto-posted from Payroll";

export const PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES = "Staff Salaries";
export const PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT =
  "Employer SSNIT Contribution";
export const PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED = "Accrued - Not Yet Paid";
/** Permanent Lock marks Staff Salaries Paid so Cash Position / Accrued Wages clear. */
export const PAYROLL_EXPENSE_PAYMENT_STATUS_PAID = "Paid";
/**
 * Expense resolved without a new Cash Position hit (cash already via AP settlement
 * or another mechanism). Distinct from Accrued (still unpaid) and Paid (cash now).
 */
export const EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH =
  "Settled (No Cash Impact)";
export const PAYROLL_EXPENSE_SUB_CATEGORY_PAYROLL = "Payroll";
export const PAYROLL_EXPENSE_PAYMENT_METHOD_ACCRUAL = "Accrual";
export const PAYROLL_PAYABLE_CATEGORY_SSNIT = "Statutory - SSNIT";
export const PAYROLL_PAYABLE_CATEGORY_PAYE = "Statutory - PAYE";

/** Non-cash P&L income for payroll deductions that reduce net but are not liabilities. */
export const PAYROLL_INCOME_CATEGORY_OTHER = "Other Income";
export const PAYROLL_INCOME_RECEIPT_SUFFIX = "DEDSAV";
export const PAYROLL_INCOME_CUSTOMER_NAME = "Payroll";
export const PAYROLL_INCOME_PAYMENT_STATUS = "Unpaid";
export const PAYROLL_INCOME_DED_SAVINGS_DESCRIPTION_SUFFIX =
  " - Deduction Savings (absence/loan/advance/welfare/other)";

export type PayrollLockFinanceTotals = {
  totalGrossPay: number;
  /**
   * Staff Salaries P&L expense on lock = current-period gross only.
   * net_only_adjustment settles prior Accrued Wages Payable (cash/net) and must
   * NOT be re-expensed here — that would double-count prior-period labor cost.
   */
  totalStaffSalariesExpense: number;
  /** Prior-period net top-ups included in net_pay; settle Accrued Wages, not P&L. */
  totalNetOnlyAdjustment: number;
  /**
   * Sum of absence + loan + advance + welfare + other deductions.
   * Posted as Other Income (deduction savings) so BS stays in balance vs net pay.
   */
  totalDeductionSavings: number;
  totalEmployerSsnitContribution: number;
  totalSsnitRemittance: number;
  totalPayeTax: number;
};

export type PayrollLockFinancePeriod = {
  year: number;
  month: number;
  payrollMonth: string;
  monthLabel: string;
  periodEndDate: string;
  remittanceDueDate: string;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumNumericField(
  rows: PayrollLockFinanceSourceRow[],
  field: keyof PayrollLockFinanceSourceRow,
): number {
  return roundCurrency(
    rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0),
  );
}

export type PayrollLockFinanceSourceRow = Pick<
  PayrollProcessingRow,
  | "employee_id"
  | "gross_pay"
  | "net_only_adjustment"
  | "absence_deduction"
  | "loan_repayment"
  | "salary_advance"
  | "welfare_deduction"
  | "other_deductions"
  | "employee_ssnit"
  | "employer_ssnit"
  | "tier2"
  | "paye_tax"
>;

type LoanRegisterBalanceRow = {
  loan_id: string;
  employee_id: string;
  loan_amount: number;
  monthly_deduction: number | null;
  total_repaid_to_date: number | null;
  outstanding_balance: number | null;
};

export function resolvePayrollLockFinancePeriod(
  payrollMonth: string,
  year?: number,
  month?: number,
): PayrollLockFinancePeriod | null {
  let resolvedYear = year;
  let resolvedMonth = month;

  if (!resolvedYear || !resolvedMonth) {
    const periodKey = payrollMonthToPeriodKey(payrollMonth);
    const parsed = periodKey ? parsePeriodKey(periodKey) : null;
    resolvedYear = resolvedYear ?? parsed?.year;
    resolvedMonth = resolvedMonth ?? parsed?.month;
  }

  if (!resolvedYear || !resolvedMonth) {
    return null;
  }

  const remittanceMonth = resolvedMonth === 12 ? 1 : resolvedMonth + 1;
  const remittanceYear = resolvedMonth === 12 ? resolvedYear + 1 : resolvedYear;

  return {
    year: resolvedYear,
    month: resolvedMonth,
    payrollMonth: payrollMonth.slice(0, 10),
    monthLabel: formatPeriodLabel(resolvedYear, resolvedMonth),
    periodEndDate: getPeriodEndDate(resolvedYear, resolvedMonth),
    remittanceDueDate: `${remittanceYear}-${String(remittanceMonth).padStart(2, "0")}-14`,
  };
}

export function calculatePayrollDeductionSavingsTotal(
  rows: Pick<
    PayrollLockFinanceSourceRow,
    | "absence_deduction"
    | "loan_repayment"
    | "salary_advance"
    | "welfare_deduction"
    | "other_deductions"
  >[],
): number {
  return roundCurrency(
    rows.reduce(
      (sum, row) =>
        sum +
        (Number(row.absence_deduction) || 0) +
        (Number(row.loan_repayment) || 0) +
        (Number(row.salary_advance) || 0) +
        (Number(row.welfare_deduction) || 0) +
        (Number(row.other_deductions) || 0),
      0,
    ),
  );
}

export function calculatePayrollLockFinanceTotals(
  rows: PayrollLockFinanceSourceRow[],
): PayrollLockFinanceTotals {
  const totalGrossPay = sumNumericField(rows, "gross_pay");
  const totalNetOnlyAdjustment = sumNumericField(rows, "net_only_adjustment");
  const totalEmployeeSsnit = sumNumericField(rows, "employee_ssnit");
  const totalEmployerSsnit = sumNumericField(rows, "employer_ssnit");
  const totalTier2 = sumNumericField(rows, "tier2");

  return {
    totalGrossPay,
    totalStaffSalariesExpense: totalGrossPay,
    totalNetOnlyAdjustment,
    totalDeductionSavings: calculatePayrollDeductionSavingsTotal(rows),
    totalEmployerSsnitContribution: roundCurrency(
      totalEmployerSsnit + totalTier2,
    ),
    totalSsnitRemittance: roundCurrency(
      totalEmployeeSsnit + totalEmployerSsnit + totalTier2,
    ),
    totalPayeTax: sumNumericField(rows, "paye_tax"),
  };
}

export function buildPayrollExpenseAutoDescription(monthLabel: string): string {
  return `${PAYROLL_EXPENSE_AUTO_DESCRIPTION_PREFIX} ${monthLabel}`;
}

export function buildPayrollDeductionSavingsDescription(
  monthLabel: string,
): string {
  return `${buildPayrollExpenseAutoDescription(monthLabel)}${PAYROLL_INCOME_DED_SAVINGS_DESCRIPTION_SUFFIX}`;
}

export function buildPayrollDeductionSavingsInvoiceNo(periodKey: string): string {
  return buildPayrollExpenseReceiptNo(PAYROLL_INCOME_RECEIPT_SUFFIX, periodKey);
}

export function buildPayrollSsnitPayableDescription(monthLabel: string): string {
  return `SSNIT contributions for ${monthLabel} (Employee + Employer + Tier 2)`;
}

export function buildPayrollPayePayableDescription(monthLabel: string): string {
  return `PAYE tax withheld for ${monthLabel}`;
}

export function buildPayrollExpenseReceiptNo(
  receiptSuffix: string,
  periodKey: string,
): string {
  return `PAYROLL-${receiptSuffix}-${periodKey}`;
}

function isExpensePaidStatus(paymentStatus: string | null | undefined): boolean {
  return (paymentStatus ?? "").trim().toLowerCase() === "paid";
}

function buildExpenseRegisterPayload(
  period: PayrollLockFinancePeriod,
  expenseCategory: string,
  amount: number,
  vendor: string,
  receiptSuffix: string,
  tenantId: string,
  paymentStatus: string = PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
  businessUnitId: string | null = null,
) {
  const description = buildPayrollExpenseAutoDescription(period.monthLabel);
  const periodKey = payrollMonthToPeriodKey(period.payrollMonth) ?? "unknown";

  return {
    tenant_id: tenantId,
    date: period.periodEndDate,
    expense_category: expenseCategory,
    sub_category: PAYROLL_EXPENSE_SUB_CATEGORY_PAYROLL,
    description,
    vendor,
    price: amount,
    quantity: 1,
    amount,
    payment_method: PAYROLL_EXPENSE_PAYMENT_METHOD_ACCRUAL,
    approved_by: "System",
    receipt_no: buildPayrollExpenseReceiptNo(receiptSuffix, periodKey),
    payment_status: paymentStatus,
    notes: null,
    business_unit_id: businessUnitId,
  };
}

async function upsertPayrollExpenseRegisterEntry(
  admin: SupabaseClient,
  payload: ReturnType<typeof buildExpenseRegisterPayload>,
): Promise<"inserted" | "updated" | "unchanged" | "skipped_already_paid"> {
  const { data: existing, error: selectError } = await admin
    .from("expense_register")
    .select("id, expense_category, payment_status, amount")
    .eq("tenant_id", payload.tenant_id)
    .eq("receipt_no", payload.receipt_no)
    .maybeSingle();

  if (selectError) {
    throw new Error(selectError.message);
  }

  if (existing) {
    const existingAlreadyPaid = isExpensePaidStatus(existing.payment_status);
    const targetingPaid = isExpensePaidStatus(payload.payment_status);

    // Double-post guard: if Expense Register already marked this PAYROLL-SAL Paid
    // (manual Accrued→Paid), keep Paid — do not Accrue-then-rePaid. Cash Position
    // is live-derived from Paid, so leaving Paid avoids a second outflow.
    if (existingAlreadyPaid && targetingPaid) {
      const needsNonStatusUpdate =
        existing.expense_category !== payload.expense_category ||
        Number(existing.amount) !== Number(payload.amount);

      if (!needsNonStatusUpdate) {
        return "skipped_already_paid";
      }

      const { error: updateError } = await admin
        .from("expense_register")
        .update({
          date: payload.date,
          expense_category: payload.expense_category,
          sub_category: payload.sub_category,
          description: payload.description,
          vendor: payload.vendor,
          price: payload.price,
          quantity: payload.quantity,
          amount: payload.amount,
          payment_method: payload.payment_method,
          // Preserve Paid; do not touch notes (may hold cash_paid= shortfall).
        })
        .eq("id", existing.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      return "skipped_already_paid";
    }

    const needsUpdate =
      existing.expense_category !== payload.expense_category ||
      existing.payment_status !== payload.payment_status ||
      Number(existing.amount) !== Number(payload.amount);

    if (!needsUpdate) {
      return "unchanged";
    }

    const { error: updateError } = await admin
      .from("expense_register")
      .update({
        date: payload.date,
        expense_category: payload.expense_category,
        sub_category: payload.sub_category,
        description: payload.description,
        vendor: payload.vendor,
        price: payload.price,
        quantity: payload.quantity,
        amount: payload.amount,
        payment_method: payload.payment_method,
        payment_status: payload.payment_status,
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return "updated";
  }

  const { error: insertError } = await admin.from("expense_register").insert(payload);

  if (insertError) {
    throw new Error(insertError.message);
  }

  return "inserted";
}

export async function repairPayrollAutoPostedExpenseRegisterEntry(
  admin: SupabaseClient,
  receiptNo: string,
  expenseCategory: string,
  tenantId: string,
): Promise<"updated" | "not_found"> {
  const { data: existing, error: selectError } = await admin
    .from("expense_register")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("receipt_no", receiptNo)
    .maybeSingle();

  if (selectError) {
    throw new Error(selectError.message);
  }

  if (!existing) {
    return "not_found";
  }

  const { error: updateError } = await admin
    .from("expense_register")
    .update({
      expense_category: expenseCategory,
      payment_status: PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
      payment_method: PAYROLL_EXPENSE_PAYMENT_METHOD_ACCRUAL,
      sub_category: PAYROLL_EXPENSE_SUB_CATEGORY_PAYROLL,
    })
    .eq("id", existing.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return "updated";
}

function buildDeductionSavingsIncomePayload(
  period: PayrollLockFinancePeriod,
  amount: number,
  tenantId: string,
) {
  const periodKey = payrollMonthToPeriodKey(period.payrollMonth) ?? "unknown";

  return {
    tenant_id: tenantId,
    date: period.periodEndDate,
    due_date: period.periodEndDate,
    invoice_no: buildPayrollDeductionSavingsInvoiceNo(periodKey),
    customer_name: PAYROLL_INCOME_CUSTOMER_NAME,
    client_id: null,
    entry_type: "service" as const,
    service_category: PAYROLL_INCOME_CATEGORY_OTHER,
    description: buildPayrollDeductionSavingsDescription(period.monthLabel),
    amount,
    amount_received: 0,
    // Non-cash P&L income — keep AR at zero (same pattern as forfeited-wage income).
    outstanding_balance: 0,
    payment_status: PAYROLL_INCOME_PAYMENT_STATUS,
    notes:
      "Non-cash payroll deduction savings (absence/loan/advance/welfare/other); auto-posted on payroll lock.",
    tax_inclusive: true,
    net_of_tax_amount: amount,
    output_vat_amount: 0,
    output_tax_component: null,
    wht_rate: null,
    wht_amount: 0,
    // Explicit flag: Income Register UI + DB trigger must not apply VAT/WHT/AR.
    is_system_adjustment: true,
  };
}

async function upsertPayrollDeductionSavingsIncomeEntry(
  admin: SupabaseClient,
  payload: ReturnType<typeof buildDeductionSavingsIncomePayload>,
): Promise<"inserted" | "updated" | "unchanged"> {
  const { data: existing, error: selectError } = await admin
    .from("income_register")
    .select("id, amount, service_category, description")
    .eq("tenant_id", payload.tenant_id)
    .eq("invoice_no", payload.invoice_no)
    .maybeSingle();

  if (selectError) {
    throw new Error(selectError.message);
  }

  if (existing) {
    const needsUpdate =
      Number(existing.amount) !== Number(payload.amount) ||
      existing.service_category !== payload.service_category ||
      existing.description !== payload.description;

    if (!needsUpdate) {
      return "unchanged";
    }

    const { error: updateError } = await admin
      .from("income_register")
      .update({
        date: payload.date,
        due_date: payload.due_date,
        customer_name: payload.customer_name,
        service_category: payload.service_category,
        description: payload.description,
        amount: payload.amount,
        amount_received: payload.amount_received,
        outstanding_balance: payload.outstanding_balance,
        payment_status: payload.payment_status,
        notes: payload.notes,
        net_of_tax_amount: payload.net_of_tax_amount,
        output_vat_amount: payload.output_vat_amount,
        output_tax_component: payload.output_tax_component,
        wht_rate: payload.wht_rate,
        wht_amount: payload.wht_amount,
        tax_inclusive: payload.tax_inclusive,
        is_system_adjustment: payload.is_system_adjustment,
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return "updated";
  }

  const { error: insertError } = await admin
    .from("income_register")
    .insert(payload);

  if (insertError) {
    throw new Error(insertError.message);
  }

  return "inserted";
}

/**
 * Deterministic per-loan allocation of a payroll-period repayment total.
 * Matches calculateLoanRepaymentForEmployee economics (cap at monthly_deduction
 * and outstanding), ordered by loan_id so apply and reverse stay aligned.
 */
export function allocatePayrollLoanRepaymentAcrossLoans(
  loans: LoanRegisterBalanceRow[],
  repaymentAmount: number,
): { loanId: string; amount: number }[] {
  let remaining = roundCurrency(Math.max(0, Number(repaymentAmount) || 0));
  if (remaining <= 0) {
    return [];
  }

  const allocations: { loanId: string; amount: number }[] = [];
  const sorted = [...loans].sort((a, b) => a.loan_id.localeCompare(b.loan_id));

  for (const loan of sorted) {
    if (remaining <= 0) {
      break;
    }

    const outstanding =
      loan.outstanding_balance ??
      calculateLoanOutstanding(
        Number(loan.loan_amount) || 0,
        Number(loan.total_repaid_to_date) || 0,
      );

    if (outstanding <= 0.01) {
      continue;
    }

    const monthly = Math.max(0, Number(loan.monthly_deduction) || 0);
    const applyAmount = roundCurrency(
      Math.min(monthly, outstanding, remaining),
    );

    if (applyAmount <= 0) {
      continue;
    }

    allocations.push({ loanId: loan.loan_id, amount: applyAmount });
    remaining = roundCurrency(remaining - applyAmount);
  }

  // If payroll loan_repayment exceeds the monthly-cap sum (manual override),
  // apply the remainder FIFO against remaining outstanding.
  if (remaining > 0.009) {
    for (const loan of sorted) {
      if (remaining <= 0) {
        break;
      }

      const already =
        allocations.find((item) => item.loanId === loan.loan_id)?.amount ?? 0;
      const outstanding =
        (loan.outstanding_balance ??
          calculateLoanOutstanding(
            Number(loan.loan_amount) || 0,
            Number(loan.total_repaid_to_date) || 0,
          )) - already;

      if (outstanding <= 0.01) {
        continue;
      }

      const applyAmount = roundCurrency(Math.min(outstanding, remaining));
      if (applyAmount <= 0) {
        continue;
      }

      const existing = allocations.find((item) => item.loanId === loan.loan_id);
      if (existing) {
        existing.amount = roundCurrency(existing.amount + applyAmount);
      } else {
        allocations.push({ loanId: loan.loan_id, amount: applyAmount });
      }
      remaining = roundCurrency(remaining - applyAmount);
    }
  }

  return allocations.filter((item) => item.amount > 0);
}

/**
 * Reverse allocation uses the same loan_id order and monthly_deduction caps,
 * capped by total_repaid_to_date (post-lock balances).
 */
export function allocatePayrollLoanRepaymentReversalAcrossLoans(
  loans: LoanRegisterBalanceRow[],
  repaymentAmount: number,
): { loanId: string; amount: number }[] {
  let remaining = roundCurrency(Math.max(0, Number(repaymentAmount) || 0));
  if (remaining <= 0) {
    return [];
  }

  const allocations: { loanId: string; amount: number }[] = [];
  const sorted = [...loans].sort((a, b) => a.loan_id.localeCompare(b.loan_id));

  for (const loan of sorted) {
    if (remaining <= 0) {
      break;
    }

    const repaid = Math.max(0, Number(loan.total_repaid_to_date) || 0);
    if (repaid <= 0.01) {
      continue;
    }

    const monthly = Math.max(0, Number(loan.monthly_deduction) || 0);
    const reverseAmount = roundCurrency(Math.min(monthly, repaid, remaining));

    if (reverseAmount <= 0) {
      continue;
    }

    allocations.push({ loanId: loan.loan_id, amount: reverseAmount });
    remaining = roundCurrency(remaining - reverseAmount);
  }

  if (remaining > 0.009) {
    for (const loan of sorted) {
      if (remaining <= 0) {
        break;
      }

      const already =
        allocations.find((item) => item.loanId === loan.loan_id)?.amount ?? 0;
      const repaid =
        Math.max(0, Number(loan.total_repaid_to_date) || 0) - already;
      if (repaid <= 0.01) {
        continue;
      }

      const reverseAmount = roundCurrency(Math.min(repaid, remaining));
      if (reverseAmount <= 0) {
        continue;
      }

      const existing = allocations.find((item) => item.loanId === loan.loan_id);
      if (existing) {
        existing.amount = roundCurrency(existing.amount + reverseAmount);
      } else {
        allocations.push({ loanId: loan.loan_id, amount: reverseAmount });
      }
      remaining = roundCurrency(remaining - reverseAmount);
    }
  }

  return allocations.filter((item) => item.amount > 0);
}

export async function applyPayrollLoanRepaymentsOnLock(
  admin: SupabaseClient,
  rows: Pick<PayrollLockFinanceSourceRow, "employee_id" | "loan_repayment">[],
  tenantId: string,
): Promise<{ updatedLoans: number }> {
  const repaymentsByEmployee = new Map<string, number>();

  for (const row of rows) {
    const employeeId = row.employee_id?.trim();
    const repayment = roundCurrency(Number(row.loan_repayment) || 0);
    if (!employeeId || repayment <= 0) {
      continue;
    }
    repaymentsByEmployee.set(
      employeeId,
      roundCurrency((repaymentsByEmployee.get(employeeId) ?? 0) + repayment),
    );
  }

  if (repaymentsByEmployee.size === 0) {
    return { updatedLoans: 0 };
  }

  const employeeIds = [...repaymentsByEmployee.keys()];
  const { data: loanRows, error: loanError } = await admin
    .from("loan_register")
    .select(
      "loan_id, employee_id, loan_amount, monthly_deduction, total_repaid_to_date, outstanding_balance",
    )
    .eq("tenant_id", tenantId)
    .in("employee_id", employeeIds);

  if (loanError) {
    throw new Error(loanError.message);
  }

  const loans = (loanRows as LoanRegisterBalanceRow[] | null) ?? [];
  let updatedLoans = 0;

  for (const [employeeId, repayment] of repaymentsByEmployee) {
    const employeeLoans = loans.filter((loan) => loan.employee_id === employeeId);
    const allocations = allocatePayrollLoanRepaymentAcrossLoans(
      employeeLoans,
      repayment,
    );

    for (const allocation of allocations) {
      const loan = employeeLoans.find((item) => item.loan_id === allocation.loanId);
      if (!loan) {
        continue;
      }

      const nextRepaid = roundCurrency(
        (Number(loan.total_repaid_to_date) || 0) + allocation.amount,
      );
      const nextOutstanding = calculateLoanOutstanding(
        Number(loan.loan_amount) || 0,
        nextRepaid,
      );

      const { error: updateError } = await admin
        .from("loan_register")
        .update({
          total_repaid_to_date: nextRepaid,
          outstanding_balance: nextOutstanding,
        })
        .eq("loan_id", loan.loan_id)
        .eq("tenant_id", tenantId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      loan.total_repaid_to_date = nextRepaid;
      loan.outstanding_balance = nextOutstanding;
      updatedLoans += 1;
    }
  }

  return { updatedLoans };
}

export async function reversePayrollLoanRepaymentsOnUnlock(
  admin: SupabaseClient,
  payrollMonth: string,
  tenantId: string,
  loanRepaymentRows?: Pick<
    PayrollLockFinanceSourceRow,
    "employee_id" | "loan_repayment"
  >[],
): Promise<{ reversedLoans: number }> {
  let sourceRows = loanRepaymentRows;

  if (!sourceRows) {
    const { data: historyRows, error: historyError } = await admin
      .from("payroll_history")
      .select("employee_id, loan_repayment")
      .eq("tenant_id", tenantId)
      .eq("payroll_month", payrollMonth.slice(0, 10));

    if (historyError) {
      throw new Error(historyError.message);
    }

    sourceRows = (historyRows as
      | Pick<PayrollLockFinanceSourceRow, "employee_id" | "loan_repayment">[]
      | null) ?? [];
  }

  const repaymentsByEmployee = new Map<string, number>();
  for (const row of sourceRows) {
    const employeeId = String(row.employee_id ?? "").trim();
    const repayment = roundCurrency(Number(row.loan_repayment) || 0);
    if (!employeeId || repayment <= 0) {
      continue;
    }
    repaymentsByEmployee.set(
      employeeId,
      roundCurrency((repaymentsByEmployee.get(employeeId) ?? 0) + repayment),
    );
  }

  if (repaymentsByEmployee.size === 0) {
    return { reversedLoans: 0 };
  }

  const employeeIds = [...repaymentsByEmployee.keys()];
  const { data: loanRows, error: loanError } = await admin
    .from("loan_register")
    .select(
      "loan_id, employee_id, loan_amount, monthly_deduction, total_repaid_to_date, outstanding_balance",
    )
    .eq("tenant_id", tenantId)
    .in("employee_id", employeeIds);

  if (loanError) {
    throw new Error(loanError.message);
  }

  const loans = (loanRows as LoanRegisterBalanceRow[] | null) ?? [];
  let reversedLoans = 0;

  for (const [employeeId, repayment] of repaymentsByEmployee) {
    const employeeLoans = loans.filter((loan) => loan.employee_id === employeeId);
    const allocations = allocatePayrollLoanRepaymentReversalAcrossLoans(
      employeeLoans,
      repayment,
    );

    for (const allocation of allocations) {
      const loan = employeeLoans.find((item) => item.loan_id === allocation.loanId);
      if (!loan) {
        continue;
      }

      const nextRepaid = roundCurrency(
        Math.max(0, (Number(loan.total_repaid_to_date) || 0) - allocation.amount),
      );
      const nextOutstanding = calculateLoanOutstanding(
        Number(loan.loan_amount) || 0,
        nextRepaid,
      );

      const { error: updateError } = await admin
        .from("loan_register")
        .update({
          total_repaid_to_date: nextRepaid,
          outstanding_balance: nextOutstanding,
        })
        .eq("loan_id", loan.loan_id)
        .eq("tenant_id", tenantId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      loan.total_repaid_to_date = nextRepaid;
      loan.outstanding_balance = nextOutstanding;
      reversedLoans += 1;
    }
  }

  return { reversedLoans };
}

export async function postPayrollLockFinanceEntries(
  admin: SupabaseClient,
  period: PayrollLockFinancePeriod,
  rows: PayrollLockFinanceSourceRow[],
  tenantId: string,
  options?: {
    /**
     * Permanent Lock: mark Staff Salaries (PAYROLL-SAL-*) Paid so Cash Position
     * and Accrued Wages clear. Partial Lock must omit this (stays Accrued).
     * Employer SSNIT always stays Accrued.
     */
    markStaffSalariesPaid?: boolean;
    /**
     * Partial→Full promote: loans were already applied on Partial Lock.
     * Skip re-applying so balances are not double-reduced.
     */
    skipLoanRepayments?: boolean;
    /** Create-only stamp for new payroll expense rows; null = All Businesses. */
    businessUnitId?: string | null;
  },
): Promise<{
  insertedExpenses: number;
  insertedPayables: number;
  updatedExpenses: number;
  insertedIncome: number;
  updatedIncome: number;
  updatedLoans: number;
  staffSalariesAlreadyPaid: boolean;
  statutoryLedger: {
    sourceId: string;
    inserted: number;
    updated: number;
    deleted: number;
    skippedPaid: number;
  };
}> {
  const { syncPayrollPeriodTaxLedger } = await import(
    "./payroll-statutory-ledger-sync"
  );
  const totals = calculatePayrollLockFinanceTotals(rows);
  let insertedExpenses = 0;
  let updatedExpenses = 0;
  let insertedIncome = 0;
  let updatedIncome = 0;
  let staffSalariesAlreadyPaid = false;

  const staffSalariesPaymentStatus = options?.markStaffSalariesPaid
    ? PAYROLL_EXPENSE_PAYMENT_STATUS_PAID
    : PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED;
  const businessUnitId = options?.businessUnitId ?? null;

  const staffSalariesPayload =
    totals.totalStaffSalariesExpense > 0
      ? buildExpenseRegisterPayload(
          period,
          PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
          totals.totalStaffSalariesExpense,
          "Payroll",
          "SAL",
          tenantId,
          staffSalariesPaymentStatus,
          businessUnitId,
        )
      : null;

  if (staffSalariesPayload) {
    const result = await upsertPayrollExpenseRegisterEntry(
      admin,
      staffSalariesPayload,
    );
    if (result === "inserted") {
      insertedExpenses += 1;
    } else if (result === "updated") {
      updatedExpenses += 1;
    } else if (result === "skipped_already_paid") {
      staffSalariesAlreadyPaid = true;
    }
  }

  // Employer SSNIT (+ Tier 2) remains a P&L expense accrual. Statutory remittance
  // liability (PAYE / SSNIT employee / employer Tier 1 / Tier 2) now posts only to
  // tax_ledger_entries — Option A: stop SSNIT/GRA AP auto-post going forward.
  // Always Accrued — permanent Lock does not mark Employer SSNIT Paid.
  const employerSsnitPayload =
    totals.totalEmployerSsnitContribution > 0
      ? buildExpenseRegisterPayload(
          period,
          PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT,
          totals.totalEmployerSsnitContribution,
          "SSNIT",
          "ESSNIT",
          tenantId,
          PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
          businessUnitId,
        )
      : null;

  if (employerSsnitPayload) {
    const result = await upsertPayrollExpenseRegisterEntry(
      admin,
      employerSsnitPayload,
    );
    if (result === "inserted") {
      insertedExpenses += 1;
    } else if (result === "updated") {
      updatedExpenses += 1;
    }
  }

  // Deduction savings income restores BS balance for net-reducing deductions that
  // are not statutory remittance liabilities. net_only_adjustment is intentionally
  // excluded (settles prior Accrued Wages elsewhere).
  if (totals.totalDeductionSavings > 0) {
    const incomeResult = await upsertPayrollDeductionSavingsIncomeEntry(
      admin,
      buildDeductionSavingsIncomePayload(
        period,
        totals.totalDeductionSavings,
        tenantId,
      ),
    );
    if (incomeResult === "inserted") {
      insertedIncome += 1;
    } else if (incomeResult === "updated") {
      updatedIncome += 1;
    }
  }

  const { updatedLoans } = options?.skipLoanRepayments
    ? { updatedLoans: 0 }
    : await applyPayrollLoanRepaymentsOnLock(admin, rows, tenantId);

  const statutoryLedger = await syncPayrollPeriodTaxLedger(
    admin,
    period,
    rows,
    tenantId,
    { businessUnitId },
  );

  return {
    insertedExpenses,
    updatedExpenses,
    insertedIncome,
    updatedIncome,
    updatedLoans,
    staffSalariesAlreadyPaid,
    // Soft-deprecated: no new Statutory - SSNIT / Statutory - PAYE AP rows.
    insertedPayables: 0,
    statutoryLedger,
  };
}

export async function deletePayrollLockFinanceEntries(
  admin: SupabaseClient,
  period: PayrollLockFinancePeriod,
  tenantId: string,
  options?: {
    loanRepaymentRows?: Pick<
      PayrollLockFinanceSourceRow,
      "employee_id" | "loan_repayment"
    >[];
  },
): Promise<{
  deletedExpenses: number;
  deletedIncome: number;
  deletedPayables: number;
  deletedStatutoryLedger: number;
  reversedLoans: number;
}> {
  // Reverse loan balances using caller-supplied rows when available (reopen/
  // release already loaded history). Fall back to payroll_history query.
  const { reversedLoans } = await reversePayrollLoanRepaymentsOnUnlock(
    admin,
    period.payrollMonth,
    tenantId,
    options?.loanRepaymentRows,
  );

  const expenseDescription = buildPayrollExpenseAutoDescription(period.monthLabel);
  const periodKey = payrollMonthToPeriodKey(period.payrollMonth) ?? "unknown";
  const deductionInvoiceNo = buildPayrollDeductionSavingsInvoiceNo(periodKey);

  const { data: expenseRows, error: expenseSelectError } = await admin
    .from("expense_register")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("description", `%${expenseDescription}%`);

  if (expenseSelectError) {
    throw new Error(expenseSelectError.message);
  }

  if ((expenseRows?.length ?? 0) > 0) {
    const { error: expenseDeleteError } = await admin
      .from("expense_register")
      .delete()
      .eq("tenant_id", tenantId)
      .ilike("description", `%${expenseDescription}%`);

    if (expenseDeleteError) {
      throw new Error(expenseDeleteError.message);
    }
  }

  const { data: incomeByInvoice, error: incomeInvoiceError } = await admin
    .from("income_register")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("invoice_no", deductionInvoiceNo);

  if (incomeInvoiceError) {
    throw new Error(incomeInvoiceError.message);
  }

  const { data: incomeByDescription, error: incomeDescError } = await admin
    .from("income_register")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("description", `%${expenseDescription}%`);

  if (incomeDescError) {
    throw new Error(incomeDescError.message);
  }

  const incomeIds = [
    ...new Set(
      [...(incomeByInvoice ?? []), ...(incomeByDescription ?? [])].map(
        (row) => row.id as string,
      ),
    ),
  ];

  if (incomeIds.length > 0) {
    const { error: incomeDeleteError } = await admin
      .from("income_register")
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", incomeIds);

    if (incomeDeleteError) {
      throw new Error(incomeDeleteError.message);
    }
  }

  // Historical Option-A-era AP rows (Statutory SSNIT/PAYE) may still exist for
  // periods locked before the remittance SoR moved to tax_ledger_entries. Clear
  // those on reopen/release only; remitted tax_ledger history is left alone.
  const { data: payableRows, error: payableSelectError } = await admin
    .from("accounts_payable")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("description", `%${period.monthLabel}%`)
    .in("vendor_name", ["SSNIT", "GRA"]);

  if (payableSelectError) {
    throw new Error(payableSelectError.message);
  }

  if ((payableRows?.length ?? 0) > 0) {
    const { error: payableDeleteError } = await admin
      .from("accounts_payable")
      .delete()
      .eq("tenant_id", tenantId)
      .ilike("description", `%${period.monthLabel}%`)
      .in("vendor_name", ["SSNIT", "GRA"]);

    if (payableDeleteError) {
      throw new Error(payableDeleteError.message);
    }
  }

  const { deleteOpenPayrollPeriodTaxLedger } = await import(
    "./payroll-statutory-ledger-sync"
  );
  const deletedStatutoryLedger = await deleteOpenPayrollPeriodTaxLedger(
    admin,
    period.payrollMonth,
    tenantId,
  );

  return {
    deletedExpenses: expenseRows?.length ?? 0,
    deletedIncome: incomeIds.length,
    deletedPayables: payableRows?.length ?? 0,
    deletedStatutoryLedger,
    reversedLoans,
  };
}
