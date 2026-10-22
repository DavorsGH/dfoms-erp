import {
  buildStaffGroups,
  staffGroupKeyForProject,
} from "@/lib/attendance-staff-groups";
import { compareStaffIds } from "../employees/employee-record-utils";
import {
  ACTIVE_EMPLOYMENT_STATUS,
  buildClientAssignmentProjectCodes,
  calculateRotationDates,
  filterHistoryForClient,
  getCurrentRotationNumber,
  getLatestHistoryByEmployee,
  getContractProjectCodeForClient,
  getNextRosterNumber,
  listUnassignedRosterEmployees,
  NEW_ASSIGNMENT_LABEL,
  planFacilityRotation,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type DutyRosterSite,
  type RosterHistoryRecord,
} from "./duty-roster-utils";
import type { RosterConfigRecord } from "./roster-config-utils";

export type RotationPlanSite = {
  siteCode: string;
  siteName: string;
  requiredStaff: number | null;
};

export type RotationPlanEmployee = {
  employeeId: string;
  staffId: string;
  fullName: string;
  currentSiteCode: string | null;
  contractProject: string | null;
  position: string | null;
  shift: string | null;
};

export type PlannedHeadcountRow = {
  siteCode: string;
  siteName: string;
  requiredStaff: number;
  plannedStaff: number;
  isUnderStaffed: boolean;
};

export type RotationStartPlan = {
  updates: Array<{
    employee_id: string;
    assigned_site_id: string;
    contract_project?: string | null;
  }>;
  history: Array<
    Omit<RosterHistoryRecord, "roster_number"> & { roster_number: string }
  >;
  nextCycleStartDate: string;
  nextCycleEndDate: string;
  nextRotationNumber: number;
};

function siteOwnerCode(
  site: DutyRosterSite,
  projects: DutyRosterProject[],
): string | null {
  if (site.project?.project_code) {
    return site.project.project_code;
  }
  if (!site.project_id) {
    return null;
  }
  return (
    projects.find((project) => project.id === site.project_id)?.project_code ??
    null
  );
}

function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function listRotationPlanSites(
  clientId: string,
  sites: DutyRosterSite[],
  projects: DutyRosterProject[],
): RotationPlanSite[] {
  const anchor = getContractProjectCodeForClient(sites, projects, clientId);
  const groupedProjects = projects.map((project) => ({
    project_code: project.project_code,
    project_name: project.project_name,
    service_contract_id: project.service_contract_id,
    is_archived: project.is_archived,
    site_count: sites.filter(
      (site) => siteOwnerCode(site, projects) === project.project_code,
    ).length,
  }));
  const groupKey = anchor
    ? staffGroupKeyForProject(anchor, groupedProjects)
    : null;
  const group = groupKey
    ? buildStaffGroups(groupedProjects).find((entry) => entry.key === groupKey)
    : null;
  const projectCodes = new Set(
    group?.projectCodes ?? (anchor ? [anchor] : []),
  );

  return sites
    .filter((site) => {
      if (site.client_id !== clientId || !site.project_id) {
        return false;
      }
      const owner = siteOwnerCode(site, projects);
      if (projectCodes.size === 0) {
        return Boolean(owner);
      }
      return owner != null && projectCodes.has(owner);
    })
    .map((site) => ({
      siteCode: site.site_code,
      siteName: site.site_name,
      requiredStaff: site.required_staff,
    }))
    .sort((left, right) => left.siteCode.localeCompare(right.siteCode));
}

/** Sites the cyclic rotate uses. required_staff 0 and blank are left out. */
export function listRotatableSiteCodes(sites: RotationPlanSite[]): string[] {
  return sites
    .filter((site) => site.requiredStaff != null && site.requiredStaff > 0)
    .map((site) => site.siteCode)
    .sort((left, right) => left.localeCompare(right));
}

export function listRotationPlanEmployees(input: {
  clientId: string;
  employees: DutyRosterEmployee[];
  projects: DutyRosterProject[];
  sites: DutyRosterSite[];
}): RotationPlanEmployee[] {
  const planSites = listRotationPlanSites(
    input.clientId,
    input.sites,
    input.projects,
  );
  const siteCodes = new Set(planSites.map((site) => site.siteCode));
  const contractCodes = buildClientAssignmentProjectCodes(
    input.sites,
    input.projects,
    input.clientId,
  );
  const unassignedIds = new Set(
    listUnassignedRosterEmployees(input).map((employee) => employee.employee_id),
  );

  return input.employees
    .filter((employee) => {
      if (employee.employment_status !== ACTIVE_EMPLOYMENT_STATUS) {
        return false;
      }
      if (unassignedIds.has(employee.employee_id)) {
        return true;
      }
      const siteCode = employee.assigned_site_id?.trim() ?? "";
      if (siteCode && siteCodes.has(siteCode)) {
        return true;
      }
      return Boolean(
        employee.contract_project && contractCodes.has(employee.contract_project),
      );
    })
    .map((employee) => ({
      employeeId: employee.employee_id,
      staffId: employee.staff_id,
      fullName: employee.full_name,
      currentSiteCode: employee.assigned_site_id?.trim() || null,
      contractProject: employee.contract_project,
      position: employee.position,
      shift: employee.shift,
    }))
    .sort((left, right) => compareStaffIds(left.staffId, right.staffId));
}

export function nextSiteInRotation(
  currentSiteCode: string | null,
  rotatableSiteCodes: string[],
): string {
  if (rotatableSiteCodes.length === 0) {
    return currentSiteCode ?? "";
  }
  const index = currentSiteCode
    ? rotatableSiteCodes.indexOf(currentSiteCode)
    : -1;
  if (index < 0) {
    return rotatableSiteCodes[0] ?? "";
  }
  return rotatableSiteCodes[(index + 1) % rotatableSiteCodes.length] ?? "";
}

export function keepEveryoneNextSites(
  employees: RotationPlanEmployee[],
): Record<string, string> {
  return Object.fromEntries(
    employees.map((employee) => [
      employee.employeeId,
      employee.currentSiteCode ?? "",
    ]),
  );
}

export function rotateAllNextSites(
  employees: RotationPlanEmployee[],
  rotatableSiteCodes: string[],
): Record<string, string> {
  return Object.fromEntries(
    employees.map((employee) => [
      employee.employeeId,
      nextSiteInRotation(employee.currentSiteCode, rotatableSiteCodes),
    ]),
  );
}

export function previewPlannedHeadcount(
  employees: RotationPlanEmployee[],
  nextSiteByEmployee: Record<string, string>,
  sites: RotationPlanSite[],
): PlannedHeadcountRow[] {
  return sites
    .filter((site) => site.requiredStaff != null)
    .map((site) => {
      const plannedStaff = employees.filter(
        (employee) => nextSiteByEmployee[employee.employeeId] === site.siteCode,
      ).length;
      const requiredStaff = site.requiredStaff ?? 0;
      return {
        siteCode: site.siteCode,
        siteName: site.siteName,
        requiredStaff,
        plannedStaff,
        isUnderStaffed: plannedStaff < requiredStaff,
      };
    });
}

export function rotationPlanIsDirty(
  employees: RotationPlanEmployee[],
  nextSiteByEmployee: Record<string, string>,
): boolean {
  return employees.some((employee) => {
    const next = nextSiteByEmployee[employee.employeeId] ?? "";
    return next !== (employee.currentSiteCode ?? "");
  });
}

export function buildRotationStartFromPlan(input: {
  clientId: string;
  employees: DutyRosterEmployee[];
  projects: DutyRosterProject[];
  sites: DutyRosterSite[];
  history: RosterHistoryRecord[];
  config: RosterConfigRecord;
  nextSiteByEmployee: Record<string, string>;
  generatedBy: string;
  generatedDate: string;
}): RotationStartPlan {
  const planEmployees = listRotationPlanEmployees(input);
  const allowedSites = new Set(
    listRotationPlanSites(input.clientId, input.sites, input.projects).map(
      (site) => site.siteCode,
    ),
  );
  const clientProjectCodes = buildClientAssignmentProjectCodes(
    input.sites,
    input.projects,
    input.clientId,
  );
  const clientHistory = filterHistoryForClient(
    input.history,
    input.employees,
    clientProjectCodes,
  );
  const latestByEmployee = getLatestHistoryByEmployee(clientHistory);
  const rotationDates = calculateRotationDates(input.config);
  const nextCycleStartDate = rotationDates.nextRotationDate;
  const nextCycleEndDate = addIsoDays(
    nextCycleStartDate,
    input.config.cycle_length_days - 1,
  );
  const nextRotationNumber = getCurrentRotationNumber(clientHistory) + 1;
  let rosterCounter = getNextRosterNumber(
    clientHistory.map((row) => row.roster_number),
  );

  const updates: RotationStartPlan["updates"] = [];
  const history: RotationStartPlan["history"] = [];

  for (const employee of planEmployees) {
    const current = employee.currentSiteCode ?? "";
    const next = (input.nextSiteByEmployee[employee.employeeId] ?? current).trim();
    if (!next || next === current) {
      continue;
    }
    if (!allowedSites.has(next)) {
      continue;
    }
    const moved = planFacilityRotation({
      contractProject: employee.contractProject,
      destinationSiteCode: next,
      projects: input.projects,
      sites: input.sites,
    });
    const update: RotationStartPlan["updates"][number] = {
      employee_id: employee.employeeId,
      assigned_site_id: moved.assigned_site_id,
    };
    if (moved.contract_project !== employee.contractProject) {
      update.contract_project = moved.contract_project;
    }
    updates.push(update);

    const latest = latestByEmployee.get(employee.employeeId);
    history.push({
      roster_number: rosterCounter,
      rotation_number: nextRotationNumber,
      effective_date: nextCycleStartDate,
      end_date: nextCycleEndDate,
      employee_id: employee.employeeId,
      previous_location: current || latest?.new_location || NEW_ASSIGNMENT_LABEL,
      new_location: next,
      position: employee.position,
      shift: employee.shift,
      generated_by: input.generatedBy,
      date_generated: input.generatedDate,
    });
    const match = rosterCounter.match(/(\d+)/);
    const currentNumber = match ? Number.parseInt(match[1], 10) : history.length;
    rosterCounter = `R${String(currentNumber + 1).padStart(4, "0")}`;
  }

  return {
    updates,
    history,
    nextCycleStartDate,
    nextCycleEndDate,
    nextRotationNumber,
  };
}

export type RosterSiteAssignment = {
  employeeId: string;
  siteCode: string;
  history: {
    roster_number: string;
    rotation_number: number;
    effective_date: string;
    end_date: string;
    previous_location: string;
    new_location: string;
    position: string | null;
    shift: string | null;
    generated_by: string;
    date_generated: string;
  };
};

/** Immediate assignment of an unassigned employee onto a site of their contract. */
export function buildRosterSiteAssignment(input: {
  employee: Pick<DutyRosterEmployee, "employee_id" | "position" | "shift">;
  siteCode: string;
  rosterNumber: string;
  rotationNumber: number;
  effectiveDate: string;
  endDate: string;
  generatedBy: string;
  generatedDate: string;
}): RosterSiteAssignment {
  return {
    employeeId: input.employee.employee_id,
    siteCode: input.siteCode,
    history: {
      roster_number: input.rosterNumber,
      rotation_number: input.rotationNumber,
      effective_date: input.effectiveDate,
      end_date: input.endDate,
      previous_location: "Unassigned",
      new_location: input.siteCode,
      position: input.employee.position,
      shift: input.employee.shift,
      generated_by: input.generatedBy,
      date_generated: input.generatedDate,
    },
  };
}
