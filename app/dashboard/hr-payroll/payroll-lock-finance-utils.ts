import type { SupabaseClient } from "@supabase/supabase-js";
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
export const PAYROLL_PAYABLE_CATEGORY_SSNIT = "Statutory - SSNIT";
export const PAYROLL_PAYABLE_CATEGORY_PAYE = "Statutory - PAYE";

export type PayrollLockFinanceTotals = {
  totalGrossPay: number;
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
  | "gross_pay"
  | "employee_ssnit"
  | "employer_ssnit"
  | "tier2"
  | "paye_tax"
>;

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

export function calculatePayrollLockFinanceTotals(
  rows: PayrollLockFinanceSourceRow[],
): PayrollLockFinanceTotals {
  const totalGrossPay = sumNumericField(rows, "gross_pay");
  const totalEmployeeSsnit = sumNumericField(rows, "employee_ssnit");
  const totalEmployerSsnit = sumNumericField(rows, "employer_ssnit");
  const totalTier2 = sumNumericField(rows, "tier2");

  return {
    totalGrossPay,
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

export function buildPayrollSsnitPayableDescription(monthLabel: string): string {
  return `SSNIT contributions for ${monthLabel} (Employee + Employer + Tier 2)`;
}

export function buildPayrollPayePayableDescription(monthLabel: string): string {
  return `PAYE tax withheld for ${monthLabel}`;
}

function buildExpenseRegisterPayload(
  period: PayrollLockFinancePeriod,
  expenseCategory: string,
  amount: number,
  vendor: string,
  receiptSuffix: string,
) {
  const description = buildPayrollExpenseAutoDescription(period.monthLabel);
  const periodKey = payrollMonthToPeriodKey(period.payrollMonth) ?? "unknown";

  return {
    date: period.periodEndDate,
    expense_category: expenseCategory,
    sub_category: "Payroll",
    description,
    vendor,
    price: amount,
    quantity: 1,
    amount,
    payment_method: "Accrual",
    approved_by: "System",
    receipt_no: `PAYROLL-${receiptSuffix}-${periodKey}`,
    payment_status: "Accrued - Not Yet Paid",
    notes: null,
  };
}

function buildAccountsPayablePayload(
  period: PayrollLockFinancePeriod,
  vendorName: string,
  expenseCategory: string,
  description: string,
  amount: number,
  invoiceSuffix: string,
) {
  const periodKey = payrollMonthToPeriodKey(period.payrollMonth) ?? "unknown";

  return {
    vendor_name: vendorName,
    invoice_number: `PAYROLL-${invoiceSuffix}-${periodKey}`,
    expense_category: expenseCategory,
    sub_category: "Statutory",
    description,
    invoice_date: period.periodEndDate,
    due_date: period.remittanceDueDate,
    amount,
    amount_paid: 0,
    balance_due: amount,
    status: "Unpaid",
    notes: null,
  };
}

async function expenseEntryExists(
  admin: SupabaseClient,
  period: PayrollLockFinancePeriod,
  expenseCategory: string,
): Promise<boolean> {
  const autoDescription = buildPayrollExpenseAutoDescription(period.monthLabel);
  const { data, error } = await admin
    .from("expense_register")
    .select("id")
    .eq("expense_category", expenseCategory)
    .ilike("description", `%${autoDescription}%`)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return (data?.length ?? 0) > 0;
}

async function payableEntryExists(
  admin: SupabaseClient,
  period: PayrollLockFinancePeriod,
  expenseCategory: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("accounts_payable")
    .select("id")
    .eq("expense_category", expenseCategory)
    .ilike("description", `%${period.monthLabel}%`)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return (data?.length ?? 0) > 0;
}

export async function postPayrollLockFinanceEntries(
  admin: SupabaseClient,
  period: PayrollLockFinancePeriod,
  rows: PayrollLockFinanceSourceRow[],
): Promise<{ insertedExpenses: number; insertedPayables: number }> {
  const totals = calculatePayrollLockFinanceTotals(rows);
  const expenseRows = [];
  const payableRows = [];

  if (
    totals.totalGrossPay > 0 &&
    !(await expenseEntryExists(
      admin,
      period,
      PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
    ))
  ) {
    expenseRows.push(
      buildExpenseRegisterPayload(
        period,
        PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
        totals.totalGrossPay,
        "Payroll",
        "SAL",
      ),
    );
  }

  if (
    totals.totalEmployerSsnitContribution > 0 &&
    !(await expenseEntryExists(
      admin,
      period,
      PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT,
    ))
  ) {
    expenseRows.push(
      buildExpenseRegisterPayload(
        period,
        PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT,
        totals.totalEmployerSsnitContribution,
        "SSNIT",
        "ESSNIT",
      ),
    );
  }

  const ssnitDescription = buildPayrollSsnitPayableDescription(period.monthLabel);
  if (
    totals.totalSsnitRemittance > 0 &&
    !(await payableEntryExists(
      admin,
      period,
      PAYROLL_PAYABLE_CATEGORY_SSNIT,
    ))
  ) {
    payableRows.push(
      buildAccountsPayablePayload(
        period,
        "SSNIT",
        PAYROLL_PAYABLE_CATEGORY_SSNIT,
        ssnitDescription,
        totals.totalSsnitRemittance,
        "SSNIT",
      ),
    );
  }

  const payeDescription = buildPayrollPayePayableDescription(period.monthLabel);
  if (
    totals.totalPayeTax > 0 &&
    !(await payableEntryExists(admin, period, PAYROLL_PAYABLE_CATEGORY_PAYE))
  ) {
    payableRows.push(
      buildAccountsPayablePayload(
        period,
        "GRA",
        PAYROLL_PAYABLE_CATEGORY_PAYE,
        payeDescription,
        totals.totalPayeTax,
        "GRA",
      ),
    );
  }

  if (expenseRows.length > 0) {
    const { error } = await admin.from("expense_register").insert(expenseRows);
    if (error) {
      throw new Error(error.message);
    }
  }

  if (payableRows.length > 0) {
    const { error } = await admin.from("accounts_payable").insert(payableRows);
    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    insertedExpenses: expenseRows.length,
    insertedPayables: payableRows.length,
  };
}

export async function deletePayrollLockFinanceEntries(
  admin: SupabaseClient,
  period: PayrollLockFinancePeriod,
): Promise<{ deletedExpenses: number; deletedPayables: number }> {
  const expenseDescription = buildPayrollExpenseAutoDescription(period.monthLabel);

  const { data: expenseRows, error: expenseSelectError } = await admin
    .from("expense_register")
    .select("id")
    .ilike("description", `%${expenseDescription}%`);

  if (expenseSelectError) {
    throw new Error(expenseSelectError.message);
  }

  if ((expenseRows?.length ?? 0) > 0) {
    const { error: expenseDeleteError } = await admin
      .from("expense_register")
      .delete()
      .ilike("description", `%${expenseDescription}%`);

    if (expenseDeleteError) {
      throw new Error(expenseDeleteError.message);
    }
  }

  const { data: payableRows, error: payableSelectError } = await admin
    .from("accounts_payable")
    .select("id")
    .ilike("description", `%${period.monthLabel}%`)
    .in("vendor_name", ["SSNIT", "GRA"]);

  if (payableSelectError) {
    throw new Error(payableSelectError.message);
  }

  if ((payableRows?.length ?? 0) > 0) {
    const { error: payableDeleteError } = await admin
      .from("accounts_payable")
      .delete()
      .ilike("description", `%${period.monthLabel}%`)
      .in("vendor_name", ["SSNIT", "GRA"]);

    if (payableDeleteError) {
      throw new Error(payableDeleteError.message);
    }
  }

  return {
    deletedExpenses: expenseRows?.length ?? 0,
    deletedPayables: payableRows?.length ?? 0,
  };
}
