import { compareStaffIds } from "../employees/employee-record-utils";
import {
  normalizeProjectEntry,
  type ProjectEntry,
} from "../administration/projects-utils";
import {
  isRosterStaffingSite,
  normalizeSiteEntry,
  type SiteEntry,
} from "./sites-utils";
import type { RosterConfigRecord } from "./roster-config-utils";

export type { RosterConfigRecord } from "./roster-config-utils";

export type DutyRosterProject = ProjectEntry;
export type DutyRosterSite = SiteEntry;

export { normalizeProjectEntry as normalizeDutyRosterProject };
export { normalizeSiteEntry as normalizeDutyRosterSite };

export type DutyRosterEmployee = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  position: string | null;
  shift: string | null;
  contract_project: string | null;
  employment_status: string | null;
  project_ref?: {
    project_code: string;
    project_name: string;
  } | null;
};

export type RosterHistoryRecord = {
  roster_number: string;
  rotation_number: number | null;
  effective_date: string;
  end_date: string | null;
  employee_id: string | null;
  previous_location: string | null;
  new_location: string | null;
  position: string | null;
  shift: string | null;
  generated_by: string | null;
  date_generated: string | null;
};

export type DutyRosterFacilityRow = {
  siteCode: string;
  facilityName: string;
  morningShift: string;
  afternoonShift: string;
  supervisors: string;
  requiredStaff: number;
  totalStaff: number;
  /** True when actual staff count is below required (under-staffed). */
  isUnderStaffed: boolean;
};

export type DutyRosterRotationOption = {
  rotationNumber: number;
  cycleStartDate: string;
  cycleEndDate: string;
  label: string;
  isCurrent: boolean;
};

export type DutyRosterSummary = {
  currentRotationLabel: string;
  cycleStartDate: string;
  cycleEndDate: string;
  nextRotationDate: string;
  daysToRotation: number;
  /** Actual staff across displayed facility rows (matches table TOTAL Actual). */
  staffAssignedCount: number;
  /** Required staff across displayed facility rows (matches table TOTAL Required). */
  totalActiveCount: number;
  staffAssignedPercent: number;
  morningTime: string;
  afternoonTime: string;
  supervisorTime: string;
};

export type DutyRosterViewModel = {
  clientId: string;
  clientName: string;
  summary: DutyRosterSummary;
  rows: DutyRosterFacilityRow[];
  totals: {
    requiredStaff: number;
    totalStaff: number;
    isUnderStaffed: boolean;
  };
  currentRotationNumber: number;
  /** Rotation number rendered in the summary (live current or selected past). */
  viewRotationNumber: number;
  isHistoricalView: boolean;
  rotationOptions: DutyRosterRotationOption[];
};

export type UnassignedRosterSite = {
  siteCode: string;
  siteName: string;
};

export const ROSTER_NAME_SEPARATOR = " || ";
export const NEW_ASSIGNMENT_LABEL = "New Assignment";
export const ACTIVE_EMPLOYMENT_STATUS = "Active";

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDisplayDate(value: string): string {
  return parseIsoDate(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function normalizeDutyRosterEmployee(raw: {
  employee_id: string;
  staff_id: string;
  full_name: string;
  position: string | null;
  shift: string | null;
  contract_project: string | null;
  employment_status: string | null;
  project_ref?:
    | DutyRosterEmployee["project_ref"]
    | NonNullable<DutyRosterEmployee["project_ref"]>[]
    | null;
}): DutyRosterEmployee {
  const projectRef = Array.isArray(raw.project_ref)
    ? (raw.project_ref[0] ?? null)
    : (raw.project_ref ?? null);

  return {
    employee_id: raw.employee_id,
    staff_id: raw.staff_id,
    full_name: raw.full_name,
    position: raw.position,
    shift: raw.shift,
    contract_project: raw.contract_project,
    employment_status: raw.employment_status,
    project_ref: projectRef,
  };
}

export function isSupervisorEmployee(employee: {
  position: string | null;
  shift: string | null;
}): boolean {
  const position = (employee.position ?? "").toLowerCase();
  return position.includes("supervisor") || employee.shift === "Full Day";
}

export type DutyRosterShiftRole = "Morning" | "Afternoon" | "Supervisor";

/** Same role buckets used when Duty Roster assigns employees to facility columns. */
export function getDutyRosterShiftRole(employee: {
  position: string | null;
  shift: string | null;
}): DutyRosterShiftRole | null {
  if (isSupervisorEmployee(employee)) {
    return "Supervisor";
  }

  if (employee.shift === "Morning") {
    return "Morning";
  }

  if (employee.shift === "Afternoon") {
    return "Afternoon";
  }

  return null;
}

export function getDutyRosterShiftTime(
  config: Pick<
    RosterConfigRecord,
    "morning_time" | "afternoon_time" | "supervisor_time"
  >,
  role: DutyRosterShiftRole | null,
): string | null {
  if (role === "Morning") {
    return config.morning_time?.trim() || null;
  }
  if (role === "Afternoon") {
    return config.afternoon_time?.trim() || null;
  }
  if (role === "Supervisor") {
    return config.supervisor_time?.trim() || null;
  }
  return null;
}

export function formatDutyRosterRotationLabel(
  rotationNumber: number,
  cycleStartDate: string,
  cycleEndDate: string,
): string {
  return `Rotation ${rotationNumber}: ${formatDisplayDate(cycleStartDate)} – ${formatDisplayDate(cycleEndDate)}`;
}

export function buildDutyRosterCycleSummary(
  config: Pick<RosterConfigRecord, "cycle_start_date" | "cycle_length_days">,
  history: RosterHistoryRecord[],
  referenceDate?: Date,
) {
  const rotationDates = resolveRotationDatesForReference(
    config,
    referenceDate ?? new Date(),
  );
  const currentRotationNumber = getRotationNumberForPeriod(
    history,
    rotationDates.cycleStartDate,
    rotationDates.cycleEndDate,
  );
  const daysToRotation = calculateDaysToRotation(
    rotationDates.nextRotationDate,
    referenceDate,
  );

  return {
    currentRotationNumber,
    currentRotationLabel: formatDutyRosterRotationLabel(
      currentRotationNumber,
      rotationDates.cycleStartDate,
      rotationDates.cycleEndDate,
    ),
    cycleStartDate: rotationDates.cycleStartDate,
    cycleEndDate: rotationDates.cycleEndDate,
    nextRotationDate: rotationDates.nextRotationDate,
    daysToRotation,
  };
}

export function getProjectDisplayName(
  projectCode: string | null | undefined,
  projects: DutyRosterProject[],
  projectRef?: DutyRosterEmployee["project_ref"],
): string {
  if (projectRef?.project_name?.trim()) {
    return projectRef.project_name.trim();
  }

  if (!projectCode) {
    return "Unassigned";
  }

  return (
    projects.find((project) => project.project_code === projectCode)
      ?.project_name ?? projectCode
  );
}

function sortEmployeeNames(employees: DutyRosterEmployee[]): string[] {
  return [...employees]
    .sort((left, right) => compareStaffIds(left.staff_id, right.staff_id))
    .map((employee) => employee.full_name.trim())
    .filter(Boolean);
}

function joinEmployeeNames(employees: DutyRosterEmployee[]): string {
  const names = sortEmployeeNames(employees);
  return names.length > 0 ? names.join(ROSTER_NAME_SEPARATOR) : "—";
}

export function calculateRotationDates(
  config: Pick<RosterConfigRecord, "cycle_start_date" | "cycle_length_days">,
) {
  const cycleStart = parseIsoDate(config.cycle_start_date);
  const cycleEnd = addDays(cycleStart, config.cycle_length_days - 1);
  const nextRotationDate = addDays(cycleStart, config.cycle_length_days);

  return {
    cycleStartDate: formatIsoDate(cycleStart),
    cycleEndDate: formatIsoDate(cycleEnd),
    nextRotationDate: formatIsoDate(nextRotationDate),
  };
}

/**
 * Walk roster cycles forward/backward from config.cycle_start_date until the
 * cycle window contains referenceDate. Used by monthly service reports so the
 * staffing header reflects the rotation covering that report month — not always
 * the latest configured cycle.
 */
export function resolveRotationDatesForReference(
  config: Pick<RosterConfigRecord, "cycle_start_date" | "cycle_length_days">,
  referenceDate = new Date(),
) {
  const length = Math.max(1, Number(config.cycle_length_days) || 1);
  const ref = startOfDay(referenceDate);
  let cycleStart = parseIsoDate(config.cycle_start_date);

  while (ref < cycleStart) {
    cycleStart = addDays(cycleStart, -length);
  }

  let cycleEnd = addDays(cycleStart, length - 1);
  while (ref > cycleEnd) {
    cycleStart = addDays(cycleStart, length);
    cycleEnd = addDays(cycleStart, length - 1);
  }

  return {
    cycleStartDate: formatIsoDate(cycleStart),
    cycleEndDate: formatIsoDate(cycleEnd),
    nextRotationDate: formatIsoDate(addDays(cycleStart, length)),
  };
}

export function calculateDaysToRotation(
  nextRotationDate: string,
  referenceDate = new Date(),
): number {
  const today = startOfDay(referenceDate);
  const nextRotation = startOfDay(parseIsoDate(nextRotationDate));
  const differenceMs = nextRotation.getTime() - today.getTime();
  return Math.max(0, Math.round(differenceMs / (1000 * 60 * 60 * 24)));
}

export function getCurrentRotationNumber(
  history: RosterHistoryRecord[],
): number {
  const maxRotation = history.reduce((max, row) => {
    const rotation = Number(row.rotation_number) || 0;
    return Math.max(max, rotation);
  }, 0);

  return maxRotation > 0 ? maxRotation : 1;
}

/**
 * Prefer the rotation_number recorded for the resolved cycle window. Falls back
 * to the latest history rotation when the period has no history rows yet.
 */
export function getRotationNumberForPeriod(
  history: RosterHistoryRecord[],
  cycleStartDate: string,
  cycleEndDate: string,
): number {
  let periodMax = 0;

  for (const row of history) {
    const effective = row.effective_date?.slice(0, 10);
    if (!effective) {
      continue;
    }

    if (effective >= cycleStartDate && effective <= cycleEndDate) {
      periodMax = Math.max(periodMax, Number(row.rotation_number) || 0);
    }
  }

  return periodMax > 0 ? periodMax : getCurrentRotationNumber(history);
}

export function getNextRosterNumber(existingNumbers: string[]): string {
  let maxNumber = 0;

  for (const rosterNumber of existingNumbers) {
    const match = rosterNumber.match(/(\d+)/);
    if (match) {
      maxNumber = Math.max(maxNumber, Number.parseInt(match[1], 10));
    }
  }

  return `R${String(maxNumber + 1).padStart(4, "0")}`;
}

export function getLatestHistoryByEmployee(
  history: RosterHistoryRecord[],
): Map<string, RosterHistoryRecord> {
  const latestByEmployee = new Map<string, RosterHistoryRecord>();

  for (const row of history) {
    if (!row.employee_id) {
      continue;
    }

    const existing = latestByEmployee.get(row.employee_id);
    if (!existing || row.effective_date.localeCompare(existing.effective_date) > 0) {
      latestByEmployee.set(row.employee_id, row);
    } else if (
      row.effective_date === existing.effective_date &&
      row.roster_number.localeCompare(existing.roster_number) > 0
    ) {
      latestByEmployee.set(row.employee_id, row);
    }
  }

  return latestByEmployee;
}

export function employeeAssignmentChanged(
  employee: DutyRosterEmployee,
  latestHistory: RosterHistoryRecord | undefined,
  projects: DutyRosterProject[],
): boolean {
  if (!latestHistory) {
    return true;
  }

  const currentProjectCode = employee.contract_project ?? "";
  const currentShift = employee.shift ?? "";
  const previousProjectCode = resolveHistoryProjectCode(
    latestHistory.new_location,
    projects,
  );
  const previousShift = latestHistory.shift ?? "";

  return (
    currentProjectCode !== previousProjectCode || currentShift !== previousShift
  );
}

function resolveHistoryProjectCode(
  location: string | null | undefined,
  projects: DutyRosterProject[],
): string {
  const normalized = (location ?? "").trim();
  if (!normalized) {
    return "";
  }

  const byCode = projects.find((project) => project.project_code === normalized);
  if (byCode) {
    return byCode.project_code;
  }

  const byName = projects.find(
    (project) => project.project_name.toLowerCase() === normalized.toLowerCase(),
  );
  return byName?.project_code ?? normalized;
}

export function resolveLegacyProjectCodesForSite(
  site: Pick<DutyRosterSite, "site_name">,
  projects: DutyRosterProject[],
): string[] {
  const normalizedSiteName = site.site_name.trim().toLowerCase();

  return projects
    .filter(
      (project) =>
        project.required_staff != null &&
        project.project_name.trim().toLowerCase() === normalizedSiteName,
    )
    .map((project) => project.project_code);
}

export function getContractProjectCodeForClient(
  sites: DutyRosterSite[],
  projects: DutyRosterProject[],
  clientId: string,
): string | null {
  const clientSite = sites.find(
    (site) => site.client_id === clientId && site.project?.project_code,
  );

  return clientSite?.project?.project_code ?? null;
}

export function filterSitesForClient(
  sites: DutyRosterSite[],
  clientId: string,
): DutyRosterSite[] {
  return sites.filter((site) => site.client_id === clientId && site.project_id);
}

export function filterRosterStaffingSites(sites: DutyRosterSite[]): DutyRosterSite[] {
  return sites.filter((site) => isRosterStaffingSite(site));
}

export function getUnassignedRosterSites(
  sites: DutyRosterSite[],
  clientId: string,
): UnassignedRosterSite[] {
  return sites
    .filter((site) => site.client_id === clientId && !site.project_id)
    .map((site) => ({
      siteCode: site.site_code,
      siteName: site.site_name,
    }))
    .sort((left, right) => left.siteName.localeCompare(right.siteName));
}

function buildClientAssignmentProjectCodes(
  sites: DutyRosterSite[],
  projects: DutyRosterProject[],
  clientId: string,
): Set<string> {
  const codes = new Set<string>();
  const clientSites = filterSitesForClient(sites, clientId);

  for (const site of clientSites) {
    for (const projectCode of resolveLegacyProjectCodesForSite(site, projects)) {
      codes.add(projectCode);
    }
  }

  const contractProjectCode = getContractProjectCodeForClient(
    sites,
    projects,
    clientId,
  );
  if (contractProjectCode) {
    codes.add(contractProjectCode);
  }

  return codes;
}

function filterHistoryForClient(
  history: RosterHistoryRecord[],
  employees: DutyRosterEmployee[],
  clientProjectCodes: Set<string>,
): RosterHistoryRecord[] {
  const clientEmployeeIds = new Set(
    employees
      .filter(
        (employee) =>
          employee.contract_project &&
          clientProjectCodes.has(employee.contract_project),
      )
      .map((employee) => employee.employee_id),
  );

  return history.filter(
    (row) => row.employee_id && clientEmployeeIds.has(row.employee_id),
  );
}

export function isRosterFacilityProject(
  project: Pick<DutyRosterProject, "required_staff">,
): boolean {
  return project.required_staff != null;
}

function findProjectByCode(
  projects: DutyRosterProject[],
  projectCode: string | null | undefined,
): DutyRosterProject | undefined {
  if (!projectCode) {
    return undefined;
  }

  return projects.find((project) => project.project_code === projectCode);
}

export function isAdministrativeProjectAssignment(
  projectCode: string | null | undefined,
  projects: DutyRosterProject[],
): boolean {
  const project = findProjectByCode(projects, projectCode);
  return project != null && project.required_staff == null;
}

export function isRosterSiteAssignment(
  projectCode: string | null | undefined,
  sites: DutyRosterSite[],
  projects: DutyRosterProject[],
): boolean {
  if (!projectCode) {
    return false;
  }

  const project = findProjectByCode(projects, projectCode);
  if (project && isRosterFacilityProject(project)) {
    return true;
  }

  return sites.some((site) =>
    resolveLegacyProjectCodesForSite(site, projects).includes(projectCode),
  );
}

function buildDutyRosterFacilityRows(
  staffingSites: DutyRosterSite[],
  activeEmployees: DutyRosterEmployee[],
  projects: DutyRosterProject[],
): DutyRosterFacilityRow[] {
  return staffingSites
    .map((site) => {
      const legacyProjectCodes = resolveLegacyProjectCodesForSite(
        site,
        projects,
      );
      const normalizedSiteName = site.site_name.trim().toLowerCase();
      const siteEmployees = activeEmployees.filter((employee) => {
        if (
          employee.contract_project &&
          legacyProjectCodes.includes(employee.contract_project)
        ) {
          return true;
        }

        const displayName = getProjectDisplayName(
          employee.contract_project,
          projects,
          employee.project_ref,
        );
        return displayName.trim().toLowerCase() === normalizedSiteName;
      });
      const morningEmployees = siteEmployees.filter(
        (employee) => employee.shift === "Morning",
      );
      const afternoonEmployees = siteEmployees.filter(
        (employee) => employee.shift === "Afternoon",
      );
      const supervisorEmployees = siteEmployees.filter((employee) =>
        isSupervisorEmployee(employee),
      );
      const requiredStaff = site.required_staff ?? 0;
      const totalStaff = siteEmployees.length;

      return {
        siteCode: site.site_code,
        facilityName: site.site_name,
        morningShift: joinEmployeeNames(morningEmployees),
        afternoonShift: joinEmployeeNames(afternoonEmployees),
        supervisors: joinEmployeeNames(supervisorEmployees),
        requiredStaff,
        totalStaff,
        isUnderStaffed: totalStaff < requiredStaff,
      } satisfies DutyRosterFacilityRow;
    })
    .sort((left, right) => left.facilityName.localeCompare(right.facilityName));
}

function getRotationDateBoundsFromHistory(
  clientHistory: RosterHistoryRecord[],
  rotationNumber: number,
): { cycleStartDate: string; cycleEndDate: string } | null {
  const starts: string[] = [];
  const ends: string[] = [];

  for (const row of clientHistory) {
    if (Number(row.rotation_number) !== rotationNumber) {
      continue;
    }
    if (row.effective_date) {
      starts.push(row.effective_date.slice(0, 10));
    }
    if (row.end_date) {
      ends.push(row.end_date.slice(0, 10));
    }
  }

  if (starts.length === 0 || ends.length === 0) {
    return null;
  }

  starts.sort();
  ends.sort();
  return {
    cycleStartDate: starts[0],
    cycleEndDate: ends[ends.length - 1],
  };
}

function derivePastRotationDates(
  config: Pick<RosterConfigRecord, "cycle_start_date" | "cycle_length_days">,
  rotationNumber: number,
  currentRotationNumber: number,
  currentCycleStartDate: string,
  currentCycleEndDate: string,
): { cycleStartDate: string; cycleEndDate: string } {
  if (rotationNumber === currentRotationNumber) {
    return {
      cycleStartDate: currentCycleStartDate,
      cycleEndDate: currentCycleEndDate,
    };
  }

  const length = Math.max(1, Number(config.cycle_length_days) || 1);
  let cycleStart = parseIsoDate(currentCycleStartDate);
  const rotationsBack = currentRotationNumber - rotationNumber;

  for (let index = 0; index < rotationsBack; index += 1) {
    cycleStart = addDays(cycleStart, -length);
  }

  const cycleEnd = addDays(cycleStart, length - 1);
  return {
    cycleStartDate: formatIsoDate(cycleStart),
    cycleEndDate: formatIsoDate(cycleEnd),
  };
}

export function reconstructEmployeesForRotation(
  employees: DutyRosterEmployee[],
  clientHistory: RosterHistoryRecord[],
  rotationNumber: number,
  projects: DutyRosterProject[],
): DutyRosterEmployee[] {
  return employees.map((employee) => {
    const rows = clientHistory
      .filter(
        (row) =>
          row.employee_id === employee.employee_id &&
          row.rotation_number != null &&
          Number(row.rotation_number) <= rotationNumber,
      )
      .sort((left, right) => {
        const dateCompare = (right.effective_date ?? "").localeCompare(
          left.effective_date ?? "",
        );
        if (dateCompare !== 0) {
          return dateCompare;
        }
        return (right.roster_number ?? "").localeCompare(
          left.roster_number ?? "",
        );
      });

    if (rows.length === 0) {
      return employee;
    }

    const latest = rows[0];
    const projectCode = resolveHistoryProjectCode(
      latest.new_location,
      projects,
    );
    const project = findProjectByCode(projects, projectCode);

    return {
      ...employee,
      contract_project: projectCode || employee.contract_project,
      shift: latest.shift ?? employee.shift,
      position: latest.position ?? employee.position,
      project_ref: project
        ? {
            project_code: project.project_code,
            project_name: project.project_name,
          }
        : employee.project_ref,
    };
  });
}

export function listDutyRosterRotations(input: {
  config: RosterConfigRecord;
  clientHistory: RosterHistoryRecord[];
  currentRotationNumber: number;
  currentCycleStartDate: string;
  currentCycleEndDate: string;
}): DutyRosterRotationOption[] {
  const rotationNumbers = new Set<number>();

  for (const row of input.clientHistory) {
    const rotation = Number(row.rotation_number) || 0;
    if (rotation > 0) {
      rotationNumbers.add(rotation);
    }
  }

  rotationNumbers.add(input.currentRotationNumber);

  const options = [...rotationNumbers]
    .sort((left, right) => right - left)
    .map((rotationNumber) => {
      const isCurrent = rotationNumber === input.currentRotationNumber;
      const fromHistory = getRotationDateBoundsFromHistory(
        input.clientHistory,
        rotationNumber,
      );
      const dates =
        fromHistory ??
        derivePastRotationDates(
          input.config,
          rotationNumber,
          input.currentRotationNumber,
          input.currentCycleStartDate,
          input.currentCycleEndDate,
        );

      return {
        rotationNumber,
        cycleStartDate: dates.cycleStartDate,
        cycleEndDate: dates.cycleEndDate,
        label: formatDutyRosterRotationLabel(
          rotationNumber,
          dates.cycleStartDate,
          dates.cycleEndDate,
        ),
        isCurrent,
      } satisfies DutyRosterRotationOption;
    });

  return options;
}

export function buildDutyRosterViewModel(input: {
  clientId: string;
  clientName: string;
  config: RosterConfigRecord;
  employees: DutyRosterEmployee[];
  projects: DutyRosterProject[];
  sites: DutyRosterSite[];
  history: RosterHistoryRecord[];
  referenceDate?: Date;
  /** When set to a past rotation, renders historical assignments (read-only). */
  viewRotationNumber?: number | null;
}): DutyRosterViewModel {
  const clientSites = filterSitesForClient(input.sites, input.clientId);
  const staffingSites = filterRosterStaffingSites(clientSites);
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
  const liveCycleSummary = buildDutyRosterCycleSummary(
    input.config,
    clientHistory,
    input.referenceDate,
  );
  const currentRotationNumber = liveCycleSummary.currentRotationNumber;
  const rotationOptions = listDutyRosterRotations({
    config: input.config,
    clientHistory,
    currentRotationNumber,
    currentCycleStartDate: liveCycleSummary.cycleStartDate,
    currentCycleEndDate: liveCycleSummary.cycleEndDate,
  });
  const selectedRotation =
    input.viewRotationNumber != null &&
    rotationOptions.some(
      (option) => option.rotationNumber === input.viewRotationNumber,
    )
      ? input.viewRotationNumber
      : currentRotationNumber;
  const isHistoricalView = selectedRotation !== currentRotationNumber;
  const selectedRotationMeta =
    rotationOptions.find(
      (option) => option.rotationNumber === selectedRotation,
    ) ?? rotationOptions[0];

  const employeesForView = isHistoricalView
    ? reconstructEmployeesForRotation(
        input.employees,
        clientHistory,
        selectedRotation,
        input.projects,
      )
    : input.employees;

  const activeEmployees = employeesForView.filter(
    (employee) => employee.employment_status === ACTIVE_EMPLOYMENT_STATUS,
  );

  const cycleStartDate = selectedRotationMeta.cycleStartDate;
  const cycleEndDate = selectedRotationMeta.cycleEndDate;
  const currentRotationLabel = selectedRotationMeta.label;
  const nextRotationDate = isHistoricalView
    ? formatIsoDate(addDays(parseIsoDate(cycleEndDate), 1))
    : liveCycleSummary.nextRotationDate;
  const daysToRotation = isHistoricalView
    ? 0
    : liveCycleSummary.daysToRotation;

  const rows = buildDutyRosterFacilityRows(
    staffingSites,
    activeEmployees,
    input.projects,
  );

  const totals = rows.reduce(
    (accumulator, row) => ({
      requiredStaff: accumulator.requiredStaff + row.requiredStaff,
      totalStaff: accumulator.totalStaff + row.totalStaff,
    }),
    { requiredStaff: 0, totalStaff: 0 },
  );

  return {
    clientId: input.clientId,
    clientName: input.clientName,
    summary: {
      currentRotationLabel,
      cycleStartDate,
      cycleEndDate,
      nextRotationDate,
      daysToRotation,
      // Match facility table TOTAL row: only linked staffing sites (excludes unassigned sites).
      staffAssignedCount: totals.totalStaff,
      totalActiveCount: totals.requiredStaff,
      staffAssignedPercent:
        totals.requiredStaff > 0
          ? Math.round((totals.totalStaff / totals.requiredStaff) * 100)
          : 0,
      morningTime: input.config.morning_time?.trim() || "—",
      afternoonTime: input.config.afternoon_time?.trim() || "—",
      supervisorTime: input.config.supervisor_time?.trim() || "—",
    },
    rows,
    totals: {
      ...totals,
      isUnderStaffed: totals.totalStaff < totals.requiredStaff,
    },
    currentRotationNumber,
    viewRotationNumber: selectedRotation,
    isHistoricalView,
    rotationOptions,
  };
}

export function buildRotationHistoryInserts(input: {
  clientId: string;
  employees: DutyRosterEmployee[];
  projects: DutyRosterProject[];
  sites: DutyRosterSite[];
  history: RosterHistoryRecord[];
  config: RosterConfigRecord;
  generatedBy: string;
  generatedDate: string;
}): {
  inserts: Array<Omit<RosterHistoryRecord, "roster_number"> & { roster_number: string }>;
  nextCycleStartDate: string;
  nextRotationNumber: number;
} {
  const clientProjectCodes = buildClientAssignmentProjectCodes(
    input.sites,
    input.projects,
    input.clientId,
  );
  const activeEmployees = input.employees.filter(
    (employee) =>
      employee.employment_status === ACTIVE_EMPLOYMENT_STATUS &&
      employee.contract_project &&
      clientProjectCodes.has(employee.contract_project),
  );
  const clientHistory = filterHistoryForClient(
    input.history,
    input.employees,
    clientProjectCodes,
  );
  const latestByEmployee = getLatestHistoryByEmployee(clientHistory);
  const rotationDates = calculateRotationDates(input.config);
  const nextCycleStartDate = rotationDates.nextRotationDate;
  const nextCycleEndDate = formatIsoDate(
    addDays(parseIsoDate(nextCycleStartDate), input.config.cycle_length_days - 1),
  );
  const nextRotationNumber = getCurrentRotationNumber(clientHistory) + 1;
  let rosterCounter = getNextRosterNumber(
    clientHistory.map((row) => row.roster_number),
  );

  const inserts: Array<
    Omit<RosterHistoryRecord, "roster_number"> & { roster_number: string }
  > = [];

  for (const employee of activeEmployees) {
    const latestHistory = latestByEmployee.get(employee.employee_id);
    if (!employeeAssignmentChanged(employee, latestHistory, input.projects)) {
      continue;
    }

    const previousLocation = latestHistory?.new_location?.trim()
      ? latestHistory.new_location
      : NEW_ASSIGNMENT_LABEL;
    const newLocation = getProjectDisplayName(
      employee.contract_project,
      input.projects,
      employee.project_ref,
    );

    inserts.push({
      roster_number: rosterCounter,
      rotation_number: nextRotationNumber,
      effective_date: nextCycleStartDate,
      end_date: nextCycleEndDate,
      employee_id: employee.employee_id,
      previous_location: previousLocation,
      new_location: newLocation,
      position: employee.position,
      shift: employee.shift,
      generated_by: input.generatedBy,
      date_generated: input.generatedDate,
    });

    const match = rosterCounter.match(/(\d+)/);
    const currentNumber = match ? Number.parseInt(match[1], 10) : inserts.length;
    rosterCounter = `R${String(currentNumber + 1).padStart(4, "0")}`;
  }

  return {
    inserts,
    nextCycleStartDate,
    nextRotationNumber,
  };
}

export function formatDutyRosterEffectiveLabel(
  cycleStartDate: string,
  cycleEndDate: string,
): string {
  return `${formatDisplayDate(cycleStartDate)} to ${formatDisplayDate(cycleEndDate)}`;
}
