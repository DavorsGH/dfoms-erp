import { toNumber, roundMoney } from "@/utils/client-invoices-types";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import {
  getEmployeeById,
  type HrEmployee,
} from "@/app/dashboard/hr-payroll/employee-utils";

export const COMMISSION_STATUSES = ["pending", "approved", "paid"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const COMMISSION_RULE_LIST_SELECT =
  "id, tenant_id, employee_id, position, commission_rate, effective_start, effective_end, is_active, created_at" as const;

export const COMMISSION_CALCULATION_LIST_SELECT =
  "id, tenant_id, employee_id, period_start, period_end, total_sales_revenue, commission_rate_used, commission_amount, status, calculated_at, approved_at, paid_at, notes" as const;

export type CommissionRuleListRow = {
  id: string;
  tenant_id: string;
  employee_id: string | null;
  position: string | null;
  commission_rate: number;
  effective_start: string;
  effective_end: string | null;
  is_active: boolean;
  created_at: string;
};

export type CommissionCalculationRow = {
  id: string;
  tenant_id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  total_sales_revenue: number;
  commission_rate_used: number;
  commission_amount: number;
  status: CommissionStatus;
  calculated_at: string;
  approved_at: string | null;
  paid_at: string | null;
  notes: string | null;
};

export type CommissionRuleTargetMode = "employee" | "position";

export type CommissionRuleFormState = {
  target_mode: CommissionRuleTargetMode;
  employee_id: string;
  position: string;
  commission_rate: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
};

export function emptyCommissionRuleForm(): CommissionRuleFormState {
  return {
    target_mode: "employee",
    employee_id: "",
    position: "",
    commission_rate: "",
    effective_start: "",
    effective_end: "",
    is_active: true,
  };
}

export function normalizeCommissionRuleRow(
  row: CommissionRuleListRow,
): CommissionRuleListRow {
  return {
    ...row,
    commission_rate: toNumber(row.commission_rate),
    effective_start: row.effective_start?.slice(0, 10) ?? row.effective_start,
    effective_end: row.effective_end?.slice(0, 10) ?? null,
  };
}

export function normalizeCommissionCalculationRow(
  row: CommissionCalculationRow,
): CommissionCalculationRow {
  return {
    ...row,
    total_sales_revenue: toNumber(row.total_sales_revenue),
    commission_rate_used: toNumber(row.commission_rate_used),
    commission_amount: toNumber(row.commission_amount),
    period_start: row.period_start?.slice(0, 10) ?? row.period_start,
    period_end: row.period_end?.slice(0, 10) ?? row.period_end,
  };
}

export function commissionRuleToFormState(
  row: CommissionRuleListRow,
): CommissionRuleFormState {
  return {
    target_mode: row.employee_id ? "employee" : "position",
    employee_id: row.employee_id ?? "",
    position: row.position ?? "",
    commission_rate: String(row.commission_rate),
    effective_start: row.effective_start.slice(0, 10),
    effective_end: row.effective_end?.slice(0, 10) ?? "",
    is_active: row.is_active,
  };
}

export function formatCommissionRate(value: number) {
  return `${roundMoney(value)}%`;
}

export function formatCommissionStatus(status: CommissionStatus) {
  switch (status) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "paid":
      return "Paid";
    default:
      return status;
  }
}

export function commissionStatusBadgeClassName(status: CommissionStatus) {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-800";
    case "approved":
      return "bg-blue-100 text-blue-800";
    case "paid":
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function formatCommissionRuleTarget(
  employees: HrEmployee[],
  row: CommissionRuleListRow,
) {
  if (row.employee_id) {
    const employee = getEmployeeById(employees, row.employee_id);
    return employee
      ? `${employee.staff_id} — ${employee.full_name}`
      : row.employee_id;
  }

  return row.position ? `Position: ${row.position}` : "—";
}

export function formatCommissionEmployee(
  employees: HrEmployee[],
  row: Pick<CommissionCalculationRow, "employee_id">,
) {
  const employee = getEmployeeById(employees, row.employee_id);
  if (!employee) {
    return row.employee_id;
  }

  return `${employee.staff_id} — ${employee.full_name}`;
}

export function formatCommissionMoney(value: number) {
  return formatGHS(value);
}

export function formatCommissionPeriod(start: string, end: string) {
  return `${start.slice(0, 10)} – ${end.slice(0, 10)}`;
}

export function buildCommissionRulePayload(form: CommissionRuleFormState) {
  const employeeId =
    form.target_mode === "employee" ? form.employee_id.trim() || null : null;
  const position =
    form.target_mode === "position" ? form.position.trim() || null : null;

  return {
    employee_id: employeeId,
    position,
    commission_rate: toNumber(form.commission_rate),
    effective_start: form.effective_start,
    effective_end: form.effective_end.trim() || null,
    is_active: form.is_active,
  };
}

export function validateCommissionRuleForm(form: CommissionRuleFormState): string | null {
  if (form.target_mode === "employee" && !form.employee_id.trim()) {
    return "Select an employee for this rule.";
  }

  if (form.target_mode === "position" && !form.position.trim()) {
    return "Enter a position for this rule.";
  }

  const rate = toNumber(form.commission_rate);
  if (rate < 0 || rate > 100) {
    return "Commission rate must be between 0 and 100.";
  }

  if (!form.effective_start.trim()) {
    return "Effective start date is required.";
  }

  if (form.effective_end.trim() && form.effective_end < form.effective_start) {
    return "Effective end must be on or after effective start.";
  }

  return null;
}
