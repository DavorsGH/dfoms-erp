import {
  findStaffGroup,
  staffGroupKeyForProject,
  type StaffGroupProject,
} from "@/lib/attendance-staff-groups";
import {
  listRosterContractChoices,
  type RosterContractChoice,
  type RosterContractProject,
  type RosterContractSite,
} from "@/lib/roster-contract-choices";

export type ContractSiteOption = {
  site_code: string;
  site_name?: string | null;
  client_id: string | null;
  project_code?: string | null;
  project?: { project_code?: string | null } | { project_code?: string | null }[] | null;
};

export function siteProjectCode(site: ContractSiteOption | null | undefined): string {
  if (!site) {
    return "";
  }
  const embedded = Array.isArray(site.project) ? site.project[0] : site.project;
  return embedded?.project_code?.trim() || site.project_code?.trim() || "";
}

export function listOperationsContractChoices(input: {
  projects: RosterContractProject[];
  sites: RosterContractSite[];
}): RosterContractChoice[] {
  return listRosterContractChoices({
    projects: input.projects,
    sites: input.sites,
    employees: [],
  });
}

export function contractProjectCodes(
  groupKey: string,
  projects: StaffGroupProject[],
): string[] {
  return findStaffGroup(groupKey, projects)?.projectCodes ?? [];
}

export function sitesForContract<T extends ContractSiteOption>(
  sites: T[],
  groupKey: string,
  projects: StaffGroupProject[],
): T[] {
  const codes = new Set(contractProjectCodes(groupKey, projects));
  if (codes.size === 0) {
    return [];
  }
  return sites.filter((site) => codes.has(siteProjectCode(site)));
}

/** Prefer the site's contract. Fall back to the customer only when one contract uses it. */
export function contractKeyForStoredRecord(input: {
  clientId: string | null | undefined;
  siteProjectCode: string | null | undefined;
  projects: StaffGroupProject[];
  choices: RosterContractChoice[];
}): string {
  const siteKey = staffGroupKeyForProject(input.siteProjectCode, input.projects);
  if (siteKey && input.choices.some((choice) => choice.groupKey === siteKey)) {
    return siteKey;
  }
  const clientId = input.clientId?.trim() ?? "";
  if (!clientId) {
    return "";
  }
  return (
    input.choices.find((choice) => choice.clientId === clientId)?.groupKey ?? ""
  );
}

export function contractLabelForStoredRecord(
  input: {
    clientId: string | null | undefined;
    siteProjectCode: string | null | undefined;
    projects: StaffGroupProject[];
    choices: RosterContractChoice[];
  },
  fallback: string,
): string {
  const key = contractKeyForStoredRecord(input);
  return input.choices.find((choice) => choice.groupKey === key)?.label ?? fallback;
}

export function staffForSelectedSite<
  T extends { employee_id: string; assigned_site_id?: string | null },
>(employees: T[], siteCode: string, showAllStaff: boolean, selectedEmployeeId: string): T[] {
  if (!siteCode || showAllStaff) {
    return employees;
  }
  const onSite = employees.filter(
    (employee) => (employee.assigned_site_id ?? "") === siteCode,
  );
  if (
    selectedEmployeeId &&
    !onSite.some((employee) => employee.employee_id === selectedEmployeeId)
  ) {
    const selected = employees.find(
      (employee) => employee.employee_id === selectedEmployeeId,
    );
    if (selected) {
      return [selected, ...onSite];
    }
  }
  return onSite;
}
