import type { Approver } from "./lookup-types";

type ApproverRow = {
  employee_id: string;
  employees: { full_name: string } | { full_name: string }[] | null;
};

export function mapApproverRows(rows: ApproverRow[]): Approver[] {
  return rows
    .map((row) => {
      const employee = Array.isArray(row.employees)
        ? row.employees[0]
        : row.employees;

      return {
        employee_id: row.employee_id,
        full_name: employee?.full_name ?? row.employee_id,
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
