import type { AppRole } from "@/app/dashboard/user-account-types";

const STAFF_LOGIN_ROLES = new Set<AppRole>([
  "super_admin",
  "finance",
  "finance_admin",
  "hr",
  "director",
  "operations_manager",
  "supervisor",
  "employee",
  "sales_rep",
]);

export type LeaveApproverEmployee = {
  employee_id: string;
  staff_id: string | null;
  full_name: string | null;
  position: string | null;
  employment_status: string | null;
};

export type LeaveApproverAccount = {
  auth_uid: string;
  employee_id: string | null;
  is_active: boolean | null;
  role: string | null;
};

export type LeaveApproverChoice = {
  key: string;
  authUid: string | null;
  label: string;
  disabled: boolean;
};

export function isStaffLoginRole(role: string | null | undefined): boolean {
  return STAFF_LOGIN_ROLES.has((role ?? "") as AppRole);
}

export function leaveApproverChoiceLabel(input: {
  fullName: string | null | undefined;
  staffId: string | null | undefined;
  position: string | null | undefined;
  hasStaffLogin: boolean;
}): string {
  const name = input.fullName?.trim() || "Unnamed employee";
  const staffId = input.staffId?.trim() || "No staff ID";
  const position = input.position?.trim() || "No position";
  const base = `${name} (${staffId}) — ${position}`;
  return input.hasStaffLogin ? base : `${base} — No login yet`;
}

export function staffLoginForEmployee(
  employeeId: string,
  accounts: LeaveApproverAccount[],
): LeaveApproverAccount | null {
  const matches = accounts
    .filter(
      (account) =>
        account.employee_id === employeeId &&
        account.is_active !== false &&
        isStaffLoginRole(account.role) &&
        Boolean(account.auth_uid),
    )
    .sort((left, right) => left.auth_uid.localeCompare(right.auth_uid));
  return matches[0] ?? null;
}

export function isEligibleLeaveApprover(input: {
  account: LeaveApproverAccount | null | undefined;
  employmentStatus: string | null | undefined;
}): boolean {
  if (!input.account?.auth_uid || !input.account.employee_id) {
    return false;
  }
  if (input.account.is_active === false) {
    return false;
  }
  if (!isStaffLoginRole(input.account.role)) {
    return false;
  }
  return input.employmentStatus === "Active";
}

/** Active employees, named and sorted. A row can be chosen only with an active staff login. */
export function buildLeaveApproverChoices(
  employees: LeaveApproverEmployee[],
  accounts: LeaveApproverAccount[],
): LeaveApproverChoice[] {
  return employees
    .filter((employee) => employee.employment_status === "Active")
    .map((employee) => {
      const account = staffLoginForEmployee(employee.employee_id, accounts);
      return {
        key: employee.employee_id,
        authUid: account?.auth_uid ?? null,
        disabled: !account,
        label: leaveApproverChoiceLabel({
          fullName: employee.full_name,
          staffId: employee.staff_id,
          position: employee.position,
          hasStaffLogin: Boolean(account),
        }),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}
