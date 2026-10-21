import {
  activeStaffChoiceLabel,
  buildActiveStaffChoices,
  isEligibleActiveStaffWithLogin,
  isStaffLoginRole,
  staffLoginForEmployee,
  type ActiveStaffAccount,
  type ActiveStaffChoice,
  type ActiveStaffEmployee,
} from "@/lib/active-staff-options";

export type LeaveApproverEmployee = ActiveStaffEmployee;
export type LeaveApproverAccount = ActiveStaffAccount;

export type LeaveApproverChoice = {
  key: string;
  authUid: string | null;
  label: string;
  disabled: boolean;
};

export {
  isStaffLoginRole,
  staffLoginForEmployee,
};

export function leaveApproverChoiceLabel(input: {
  fullName: string | null | undefined;
  staffId: string | null | undefined;
  position: string | null | undefined;
  hasStaffLogin: boolean;
}): string {
  const base = activeStaffChoiceLabel({
    fullName: input.fullName,
    staffId: input.staffId,
    position: input.position,
    includePosition: true,
  });
  return input.hasStaffLogin ? base : `${base} — No login yet`;
}

export function isEligibleLeaveApprover(input: {
  account: LeaveApproverAccount | null | undefined;
  employmentStatus: string | null | undefined;
}): boolean {
  return isEligibleActiveStaffWithLogin(input);
}

function toLeaveChoice(choice: ActiveStaffChoice): LeaveApproverChoice {
  return {
    key: choice.key,
    authUid: choice.authUid,
    label: choice.label,
    disabled: !choice.selectable,
  };
}

/**
 * Active employees with a linked staff login only.
 * Inactive / terminated / no-login staff are excluded from the picker.
 */
export function buildLeaveApproverChoices(
  employees: LeaveApproverEmployee[],
  accounts: LeaveApproverAccount[],
): LeaveApproverChoice[] {
  return buildActiveStaffChoices(employees, accounts, {
    includePosition: true,
    includeWithoutLogin: false,
  }).map(toLeaveChoice);
}
