import { toNumber } from "@/utils/client-invoices-types";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import {
  getEmployeeById,
  type HrEmployee,
} from "@/app/dashboard/hr-payroll/employee-utils";

export const SALES_TARGET_PERIOD_TYPES = ["monthly", "quarterly", "yearly"] as const;
export type SalesTargetPeriodType = (typeof SALES_TARGET_PERIOD_TYPES)[number];

export const SALES_TARGET_LIST_SELECT =
  "id, tenant_id, employee_id, period_type, period_start, period_end, revenue_target, unit_target, notes, created_at" as const;

export type SalesTargetListRow = {
  id: string;
  tenant_id: string;
  employee_id: string;
  period_type: SalesTargetPeriodType;
  period_start: string;
  period_end: string;
  revenue_target: number;
  unit_target: number | null;
  notes: string | null;
  created_at: string;
};

export type SalesTargetFormState = {
  employee_id: string;
  period_type: SalesTargetPeriodType;
  period_start: string;
  period_end: string;
  revenue_target: string;
  unit_target: string;
  notes: string;
};

export function emptySalesTargetForm(
  defaultEmployeeId = "",
): SalesTargetFormState {
  return {
    employee_id: defaultEmployeeId,
    period_type: "monthly",
    period_start: "",
    period_end: "",
    revenue_target: "",
    unit_target: "",
    notes: "",
  };
}

export function normalizeSalesTargetRow(row: SalesTargetListRow): SalesTargetListRow {
  return {
    ...row,
    revenue_target: toNumber(row.revenue_target),
    unit_target: row.unit_target == null ? null : toNumber(row.unit_target),
    period_start: row.period_start?.slice(0, 10) ?? row.period_start,
    period_end: row.period_end?.slice(0, 10) ?? row.period_end,
  };
}

export function salesTargetToFormState(row: SalesTargetListRow): SalesTargetFormState {
  return {
    employee_id: row.employee_id,
    period_type: row.period_type,
    period_start: row.period_start.slice(0, 10),
    period_end: row.period_end.slice(0, 10),
    revenue_target: String(row.revenue_target),
    unit_target: row.unit_target == null ? "" : String(row.unit_target),
    notes: row.notes ?? "",
  };
}

export function formatSalesTargetPeriodType(value: SalesTargetPeriodType) {
  switch (value) {
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "yearly":
      return "Yearly";
    default:
      return value;
  }
}

export function formatSalesTargetPeriodRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return `${start} – ${end}`;
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return `${formatter.format(startDate)} – ${formatter.format(endDate)}`;
}

export function formatSalesTargetEmployee(
  employees: HrEmployee[] | null | undefined,
  row: Pick<SalesTargetListRow, "employee_id"> | null | undefined,
) {
  const employeeId = row?.employee_id?.trim();
  if (!employeeId) {
    return "—";
  }

  const employee = getEmployeeById(employees, employeeId);
  if (!employee) {
    return employeeId;
  }

  return `${employee.staff_id} — ${employee.full_name}`;
}

export function formatSalesTargetRevenue(value: number) {
  return formatGHS(value);
}

export function buildSalesTargetPayload(form: SalesTargetFormState) {
  return {
    employee_id: form.employee_id.trim(),
    period_type: form.period_type,
    period_start: form.period_start,
    period_end: form.period_end,
    revenue_target: toNumber(form.revenue_target),
    unit_target: form.unit_target.trim()
      ? toNumber(form.unit_target)
      : null,
    notes: form.notes.trim() || null,
  };
}

export function validateSalesTargetForm(form: SalesTargetFormState): string | null {
  if (!form.employee_id.trim()) {
    return "Select an employee.";
  }

  if (!form.period_start.trim() || !form.period_end.trim()) {
    return "Period start and end dates are required.";
  }

  if (form.period_end < form.period_start) {
    return "Period end must be on or after period start.";
  }

  const revenue = toNumber(form.revenue_target);
  if (revenue < 0) {
    return "Revenue target must be zero or greater.";
  }

  if (form.unit_target.trim()) {
    const units = toNumber(form.unit_target);
    if (units < 0) {
      return "Unit target must be zero or greater.";
    }
  }

  return null;
}
