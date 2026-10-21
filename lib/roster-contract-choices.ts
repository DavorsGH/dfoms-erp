import {
  buildStaffGroups,
  staffGroupIsSelectable,
  staffGroupKeyForProject,
  withSiteCounts,
  type StaffGroupProject,
} from "@/lib/attendance-staff-groups";

export const ROSTER_CONTRACT_STORAGE_KEY = "dfoms.roster.contract";

export type RosterContractProject = StaffGroupProject & {
  contract_type?: string | null;
};

export type RosterContractSite = {
  client_id: string | null;
  project_code: string | null;
};

export type RosterContractEmployee = {
  contract_project: string | null;
  employment_status: string | null;
};

export type RosterContractChoice = {
  groupKey: string;
  label: string;
  /** Customer id the existing roster tables already use. Null when the sites disagree. */
  clientId: string | null;
  dataIssue: string | null;
  hasStaff: boolean;
};

function distinctClientIds(sites: RosterContractSite[]): string[] {
  const ids = new Set<string>();
  for (const site of sites) {
    const clientId = site.client_id?.trim() ?? "";
    if (clientId) {
      ids.add(clientId);
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

/**
 * Contracts the roster can open: staff groups that are still active and own
 * at least one site. CRM customers, archived projects, and contracts with no
 * sites (including ad hoc jobs) are left out. Storage stays on client_id.
 */
export function listRosterContractChoices(input: {
  projects: RosterContractProject[];
  sites: RosterContractSite[];
  employees: RosterContractEmployee[];
}): RosterContractChoice[] {
  const counted = withSiteCounts(
    input.projects,
    input.sites.map((site) => site.project_code),
  );
  const groups = buildStaffGroups(counted).filter((group) =>
    staffGroupIsSelectable(group, counted),
  );

  const choices: RosterContractChoice[] = [];
  for (const group of groups) {
    const codes = new Set(group.projectCodes);
    const groupSites = input.sites.filter((site) => {
      const code = site.project_code?.trim() ?? "";
      return code !== "" && codes.has(code);
    });
    if (groupSites.length === 0) {
      continue;
    }

    const clientIds = distinctClientIds(groupSites);
    let clientId: string | null = null;
    let dataIssue: string | null = null;
    if (clientIds.length === 1) {
      clientId = clientIds[0] ?? null;
    } else if (clientIds.length === 0) {
      dataIssue = `${group.label} has sites, but those sites are not linked to a customer, so its roster cannot be opened.`;
    } else {
      dataIssue = `${group.label} has sites on more than one customer (${clientIds.join(", ")}). It is listed once and its roster stays closed until those sites share one customer.`;
    }

    const hasStaff = input.employees.some((employee) => {
      if ((employee.employment_status ?? "").trim().toLowerCase() !== "active") {
        return false;
      }
      return (
        staffGroupKeyForProject(employee.contract_project, counted) === group.key
      );
    });

    choices.push({
      groupKey: group.key,
      label: group.label,
      clientId,
      dataIssue,
      hasStaff,
    });
  }

  return choices;
}

/** Session pick when it is still listed, otherwise the first contract that has staff. */
export function defaultRosterContractKey(
  choices: RosterContractChoice[],
  storedKey: string | null | undefined,
): string {
  const stored = storedKey?.trim() ?? "";
  if (stored && choices.some((choice) => choice.groupKey === stored)) {
    return stored;
  }
  const withStaff = choices.find((choice) => choice.hasStaff && choice.clientId);
  if (withStaff) {
    return withStaff.groupKey;
  }
  return choices.find((choice) => choice.clientId)?.groupKey ?? "";
}
