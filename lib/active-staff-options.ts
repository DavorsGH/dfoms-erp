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

export type ActiveStaffEmployee = {
  employee_id: string;
  staff_id: string | null;
  full_name: string | null;
  position?: string | null;
  employment_status: string | null;
};

export type ActiveStaffAccount = {
  auth_uid: string;
  employee_id: string | null;
  is_active: boolean | null;
  role: string | null;
};

export type ActiveStaffChoice = {
  key: string;
  employeeId: string;
  authUid: string | null;
  label: string;
  /** True when the row may be selected (active employment + staff login). */
  selectable: boolean;
};

export function isStaffLoginRole(role: string | null | undefined): boolean {
  return STAFF_LOGIN_ROLES.has((role ?? "") as AppRole);
}

export function isActiveEmploymentStatus(
  status: string | null | undefined,
): boolean {
  return (status ?? "").trim() === "Active";
}

export function staffLoginForEmployee(
  employeeId: string,
  accounts: ActiveStaffAccount[],
): ActiveStaffAccount | null {
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

/** Active employment + linked active staff login (can sign in and act). */
export function isEligibleActiveStaffWithLogin(input: {
  account: ActiveStaffAccount | null | undefined;
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
  return isActiveEmploymentStatus(input.employmentStatus);
}

export function activeStaffChoiceLabel(input: {
  fullName: string | null | undefined;
  staffId: string | null | undefined;
  position?: string | null | undefined;
  includePosition?: boolean;
}): string {
  const name = input.fullName?.trim() || "Unnamed employee";
  const staffId = input.staffId?.trim() || "No staff ID";
  if (input.includePosition) {
    const position = input.position?.trim() || "No position";
    return `${name} (${staffId}) — ${position}`;
  }
  return `${name} (${staffId})`;
}

export type BuildActiveStaffChoicesOptions = {
  /** When true, include Active staff who lack a login as non-selectable rows. Default: exclude them. */
  includeWithoutLogin?: boolean;
  /** Append " — Position" to the label (leave approver style). */
  includePosition?: boolean;
};

/**
 * Picker options for assigning someone who must be able to act going forward.
 * Default: only Active employees with a linked active staff login.
 */
export function buildActiveStaffChoices(
  employees: ActiveStaffEmployee[],
  accounts: ActiveStaffAccount[],
  options: BuildActiveStaffChoicesOptions = {},
): ActiveStaffChoice[] {
  const includeWithoutLogin = options.includeWithoutLogin === true;
  const includePosition = options.includePosition === true;

  return employees
    .filter((employee) => isActiveEmploymentStatus(employee.employment_status))
    .map((employee) => {
      const account = staffLoginForEmployee(employee.employee_id, accounts);
      const hasLogin = Boolean(account);
      return {
        key: employee.employee_id,
        employeeId: employee.employee_id,
        authUid: account?.auth_uid ?? null,
        selectable: hasLogin,
        label: activeStaffChoiceLabel({
          fullName: employee.full_name,
          staffId: employee.staff_id,
          position: employee.position,
          includePosition,
        }),
      };
    })
    .filter((choice) => includeWithoutLogin || choice.selectable)
    .sort((left, right) => left.label.localeCompare(right.label));
}

export const FINANCE_APPROVER_INACTIVE_BADGE =
  "Inactive — replace this approver";

export type FinanceApproverRecord = {
  employee_id: string;
  full_name: string;
  staff_id?: string | null;
  employment_status?: string | null;
};

export type AnnotatedFinanceApprover = FinanceApproverRecord & {
  isActiveApprover: boolean;
  authUid: string | null;
};

export function annotateFinanceApprovers(
  saved: FinanceApproverRecord[],
  accounts: ActiveStaffAccount[],
): AnnotatedFinanceApprover[] {
  return saved.map((approver) => {
    const account = staffLoginForEmployee(approver.employee_id, accounts);
    const isActiveApprover = isEligibleActiveStaffWithLogin({
      account,
      employmentStatus: approver.employment_status ?? null,
    });
    return {
      ...approver,
      isActiveApprover,
      authUid: account?.auth_uid ?? null,
    };
  });
}

/**
 * Skip inactive / no-login saved approvers when routing approvals.
 * If none remain eligible, callers should notify admins/directors.
 */
export function routeFinanceApprovals(approvers: AnnotatedFinanceApprover[]): {
  activeApprovers: AnnotatedFinanceApprover[];
  notifyAdminsDirectors: boolean;
} {
  const activeApprovers = approvers.filter(
    (approver) => approver.isActiveApprover,
  );
  return {
    activeApprovers,
    notifyAdminsDirectors: activeApprovers.length === 0,
  };
}
