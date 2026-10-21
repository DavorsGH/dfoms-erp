import {
  annotateFinanceApprovers,
  routeFinanceApprovals,
  type ActiveStaffAccount,
  type AnnotatedFinanceApprover,
} from "@/lib/active-staff-options";
import type { Approver } from "./lookup-types";

type ApproverEmployeeJoin = {
  full_name: string | null;
  staff_id?: string | null;
  employment_status?: string | null;
} | null;

type ApproverRow = {
  employee_id: string;
  employees: ApproverEmployeeJoin | ApproverEmployeeJoin[] | null;
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
        staff_id: employee?.staff_id ?? null,
        employment_status: employee?.employment_status ?? null,
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export function enrichApproversWithLoginEligibility(
  approvers: Approver[],
  accounts: ActiveStaffAccount[],
): AnnotatedFinanceApprover[] {
  return annotateFinanceApprovers(approvers, accounts);
}

/** Approvers offered on create/edit forms (skip inactive / no-login). */
export function activeApproversForForms(
  annotated: AnnotatedFinanceApprover[],
): Approver[] {
  const { activeApprovers } = routeFinanceApprovals(annotated);
  return activeApprovers.map((approver) => ({
    employee_id: approver.employee_id,
    full_name: approver.full_name,
    staff_id: approver.staff_id ?? null,
    employment_status: approver.employment_status ?? null,
    isActiveApprover: true,
  }));
}

export function toDisplayApprovers(
  annotated: AnnotatedFinanceApprover[],
): Approver[] {
  return annotated.map((approver) => ({
    employee_id: approver.employee_id,
    full_name: approver.full_name,
    staff_id: approver.staff_id ?? null,
    employment_status: approver.employment_status ?? null,
    isActiveApprover: approver.isActiveApprover,
  }));
}
