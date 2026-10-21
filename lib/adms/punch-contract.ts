import {
  projectsShareStaffGroup,
  type StaffGroupProject,
} from "@/lib/attendance-staff-groups";

/**
 * Company-wide scanners never flag. A contract scanner flags only when the
 * employee's project resolves to a different staff group. Projects that share
 * a service_contract_id are the same group, so PRJ10 on a PRJ01 device is not
 * another contract.
 */
export function isOtherContractPunch(input: {
  companyWide: boolean;
  deviceContractProject: string | null | undefined;
  employeeContractProject: string | null | undefined;
  projects: StaffGroupProject[];
}): boolean {
  if (input.companyWide) {
    return false;
  }
  const deviceContract = input.deviceContractProject?.trim() ?? "";
  if (!deviceContract) {
    return false;
  }
  return !projectsShareStaffGroup(
    deviceContract,
    input.employeeContractProject,
    input.projects,
  );
}

/** other_contract is recorded as well as the attendance row. It replaces a null note. */
export function sessionProcessNote(input: {
  companyWide: boolean;
  deviceContractProject: string | null | undefined;
  employeeContractProject: string | null | undefined;
  missingClockOut: boolean;
  projects: StaffGroupProject[];
}): string | null {
  if (isOtherContractPunch(input)) {
    return "other_contract";
  }
  return input.missingClockOut ? "missing_clock_out" : null;
}

export function otherContractReviewText(input: {
  deviceLabel: string;
  employeeContract: string | null | undefined;
}): string {
  const contract = input.employeeContract?.trim() || "none";
  const device = input.deviceLabel.trim() || "unknown";
  return `Punched at another contract's scanner (device ${device}, employee's contract ${contract})`;
}
