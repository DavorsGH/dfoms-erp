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
export const PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED = "Accrued - Not Yet Paid";
export const PAYROLL_EXPENSE_SUB_CATEGORY_PAYROLL = "Payroll";
export const PAYROLL_EXPENSE_PAYMENT_METHOD_ACCRUAL = "Accrual";
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

export function buildPayrollExpenseReceiptNo(
  receiptSuffix: string,
  periodKey: string,
): string {
  return `PAYROLL-${receiptSuffix}-${periodKey}`;
}

function buildExpenseRegisterPayload(
  period: PayrollLockFinancePeriod,
  expenseCategory: string,
  amount: number,
  vendor: string,
  receiptSuffix: string,
  tenantId: string,
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
    payment_status: PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
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
  tenantId: string,
) {
  const periodKey = payrollMonthToPeriodKey(period.payrollMonth) ?? "unknown";

  return {
    tenant_id: tenantId,
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

async function upsertPayrollExpenseRegisterEntry(
  admin: SupabaseClient,
  payload: ReturnType<typeof buildExpenseRegisterPayload>,
): Promise<"inserted" | "updated" | "unchanged"> {
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

async function payableEntryExists(
  admin: SupabaseClient,
  period: PayrollLockFinancePeriod,
  expenseCategory: string,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("accounts_payable")
    .select("id")
    .eq("tenant_id", tenantId)
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
  tenantId: string,
): Promise<{ insertedExpenses: number; insertedPayables: number; updatedExpenses: number }> {
  const totals = calculatePayrollLockFinanceTotals(rows);
  let insertedExpenses = 0;
  let updatedExpenses = 0;
  const payableRows = [];

  const staffSalariesPayload =
    totals.totalGrossPay > 0
      ? buildExpenseRegisterPayload(
          period,
          PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
          totals.totalGrossPay,
          "Payroll",
          "SAL",
          tenantId,
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
    }
  }

  const employerSsnitPayload =
    totals.totalEmployerSsnitContribution > 0
      ? buildExpenseRegisterPayload(
          period,
          PAYROLL_EXPENSE_CATEGORY_EMPLOYER_SSNIT,
          totals.totalEmployerSsnitContribution,
          "SSNIT",
          "ESSNIT",
          tenantId,
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

  const ssnitDescription = buildPayrollSsnitPayableDescription(period.monthLabel);
  if (
    totals.totalSsnitRemittance > 0 &&
    !(await payableEntryExists(
      admin,
      period,
      PAYROLL_PAYABLE_CATEGORY_SSNIT,
      tenantId,
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
        tenantId,
      ),
    );
  }

  const payeDescription = buildPayrollPayePayableDescription(period.monthLabel);
  if (
    totals.totalPayeTax > 0 &&
    !(await payableEntryExists(admin, period, PAYROLL_PAYABLE_CATEGORY_PAYE, tenantId))
  ) {
    payableRows.push(
      buildAccountsPayablePayload(
        period,
        "GRA",
        PAYROLL_PAYABLE_CATEGORY_PAYE,
        payeDescription,
        totals.totalPayeTax,
        "GRA",
        tenantId,
      ),
    );
  }

  if (payableRows.length > 0) {
    const { error } = await admin.from("accounts_payable").insert(payableRows);
    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    insertedExpenses,
    updatedExpenses,
    insertedPayables: payableRows.length,
  };
}

export async function deletePayrollLockFinanceEntries(
  admin: SupabaseClient,
  period: PayrollLockFinancePeriod,
  tenantId: string,
): Promise<{ deletedExpenses: number; deletedPayables: number }> {
  const expenseDescription = buildPayrollExpenseAutoDescription(period.monthLabel);

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

  return {
    deletedExpenses: expenseRows?.length ?? 0,
    deletedPayables: payableRows?.length ?? 0,
  };
}
