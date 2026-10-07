export type SalaryAdvanceStatus = "outstanding" | "deducted";

export type SalaryAdvanceRegisterEntry = {
  advance_id: string;
  tenant_id?: string;
  business_unit_id: string | null;
  employee_id: string;
  amount: number;
  date_issued: string;
  deduct_payroll_month: string;
  payment_account_id: string;
  approved_by: string;
  status: SalaryAdvanceStatus;
  deducted_at: string | null;
  payroll_month_locked: string | null;
  notes: string | null;
};

export const SALARY_ADVANCE_ENTITY_TYPE = "ADV";

export function normalizePayrollMonthStart(value: string): string {
  const datePart = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})/.exec(datePart);
  if (!match) {
    return datePart;
  }
  return `${match[1]}-${match[2]}-01`;
}

export function payrollMonthStartFromDate(value: string): string {
  const datePart = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) {
    return normalizePayrollMonthStart(value);
  }
  return `${match[1]}-${match[2]}-01`;
}

function registerAdvanceMatchesBusinessUnit(
  row: SalaryAdvanceRegisterEntry,
  businessUnitId: string | null | undefined,
): boolean {
  const rowBu = row.business_unit_id?.trim() || null;
  const scopeBu = businessUnitId?.trim() || null;
  if (scopeBu === null) {
    return rowBu === null;
  }
  return rowBu === scopeBu;
}

export function sumSalaryAdvancesForEmployeeInMonth(
  advances: SalaryAdvanceRegisterEntry[],
  employeeId: string,
  payrollMonth: string,
  businessUnitId?: string | null,
): number {
  const monthKey = normalizePayrollMonthStart(payrollMonth);
  return advances
    .filter(
      (row) =>
        row.employee_id === employeeId &&
        normalizePayrollMonthStart(row.deduct_payroll_month) === monthKey &&
        row.status === "outstanding" &&
        registerAdvanceMatchesBusinessUnit(row, businessUnitId),
    )
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
}

export function salaryAdvancePortionForDedsav(
  salaryAdvance: number,
  registerSumForEmployee: number,
): number {
  return Math.max(
    0,
    Math.round((salaryAdvance - registerSumForEmployee) * 100) / 100,
  );
}

export function formatSalaryAdvanceStatus(status: SalaryAdvanceStatus): string {
  return status === "deducted" ? "Deducted" : "Outstanding";
}

/** Map RPC / database errors to staff-friendly copy for the advance form. */
export function formatSalaryAdvanceSaveError(
  raw: string | undefined | null,
): string {
  const message = (raw ?? "").trim();
  if (!message) {
    return "Unable to save salary advances. Check the form and try again.";
  }
  if (/invalid input syntax for type date/i.test(message)) {
    return "Choose a valid payroll month (for example October 2026).";
  }
  if (
    message.includes("SQL") ||
    message.includes("json") ||
    message.includes("syntax")
  ) {
    return "Unable to save salary advances. Check the form and try again.";
  }
  return message;
}
