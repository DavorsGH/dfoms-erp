import { compareStaffIds } from "../employees/employee-record-utils";

export type RosterConfigRecord = {
  id: string;
  cycle_start_date: string;
  cycle_length_days: number;
  morning_time: string | null;
  afternoon_time: string | null;
  supervisor_time: string | null;
};

export type DutyRosterProject = {
  project_code: string;
  project_name: string;
  required_staff: number | null;
};

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
  projectCode: string;
  facilityName: string;
  morningShift: string;
  afternoonShift: string;
  supervisors: string;
  requiredStaff: number;
  totalStaff: number;
  isStaffingMismatch: boolean;
};

export type DutyRosterSummary = {
  currentRotationLabel: string;
  cycleStartDate: string;
  cycleEndDate: string;
  nextRotationDate: string;
  daysToRotation: number;
  staffAssignedCount: number;
  totalActiveCount: number;
  staffAssignedPercent: number;
  morningTime: string;
  afternoonTime: string;
  supervisorTime: string;
};

export type DutyRosterViewModel = {
  summary: DutyRosterSummary;
  rows: DutyRosterFacilityRow[];
  totals: {
    requiredStaff: number;
    totalStaff: number;
  };
  currentRotationNumber: number;
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
  projects: DutyRosterProject[],
): boolean {
  const project = findProjectByCode(projects, projectCode);
  return project != null && isRosterFacilityProject(project);
}

export function buildDutyRosterViewModel(input: {
  config: RosterConfigRecord;
  employees: DutyRosterEmployee[];
  projects: DutyRosterProject[];
  history: RosterHistoryRecord[];
  referenceDate?: Date;
}): DutyRosterViewModel {
  const activeEmployees = input.employees.filter(
    (employee) => employee.employment_status === ACTIVE_EMPLOYMENT_STATUS,
  );
  const rosterRelevantEmployees = activeEmployees.filter(
    (employee) =>
      !isAdministrativeProjectAssignment(
        employee.contract_project,
        input.projects,
      ),
  );
  const rosterAssignedEmployees = rosterRelevantEmployees.filter((employee) =>
    isRosterSiteAssignment(employee.contract_project, input.projects),
  );
  const rotationDates = calculateRotationDates(input.config);
  const daysToRotation = calculateDaysToRotation(
    rotationDates.nextRotationDate,
    input.referenceDate,
  );
  const currentRotationNumber = getCurrentRotationNumber(input.history);

  const rosterProjects = input.projects.filter((project) =>
    isRosterFacilityProject(project),
  );

  const rows = rosterProjects
    .map((project) => {
      const siteEmployees = activeEmployees.filter(
        (employee) => employee.contract_project === project.project_code,
      );
      const morningEmployees = siteEmployees.filter(
        (employee) => employee.shift === "Morning",
      );
      const afternoonEmployees = siteEmployees.filter(
        (employee) => employee.shift === "Afternoon",
      );
      const supervisorEmployees = siteEmployees.filter((employee) =>
        isSupervisorEmployee(employee),
      );
      const requiredStaff = project.required_staff ?? 0;
      const totalStaff = siteEmployees.length;

      return {
        projectCode: project.project_code,
        facilityName: project.project_name,
        morningShift: joinEmployeeNames(morningEmployees),
        afternoonShift: joinEmployeeNames(afternoonEmployees),
        supervisors: joinEmployeeNames(supervisorEmployees),
        requiredStaff,
        totalStaff,
        isStaffingMismatch: totalStaff !== requiredStaff,
      } satisfies DutyRosterFacilityRow;
    })
    .sort((left, right) => left.facilityName.localeCompare(right.facilityName));

  const totals = rows.reduce(
    (accumulator, row) => ({
      requiredStaff: accumulator.requiredStaff + row.requiredStaff,
      totalStaff: accumulator.totalStaff + row.totalStaff,
    }),
    { requiredStaff: 0, totalStaff: 0 },
  );

  return {
    summary: {
      currentRotationLabel: `Rotation ${currentRotationNumber}: ${formatDisplayDate(rotationDates.cycleStartDate)} – ${formatDisplayDate(rotationDates.cycleEndDate)}`,
      cycleStartDate: rotationDates.cycleStartDate,
      cycleEndDate: rotationDates.cycleEndDate,
      nextRotationDate: rotationDates.nextRotationDate,
      daysToRotation,
      staffAssignedCount: rosterAssignedEmployees.length,
      totalActiveCount: rosterRelevantEmployees.length,
      staffAssignedPercent:
        rosterRelevantEmployees.length > 0
          ? Math.round(
              (rosterAssignedEmployees.length / rosterRelevantEmployees.length) *
                100,
            )
          : 0,
      morningTime: input.config.morning_time?.trim() || "—",
      afternoonTime: input.config.afternoon_time?.trim() || "—",
      supervisorTime: input.config.supervisor_time?.trim() || "—",
    },
    rows,
    totals,
    currentRotationNumber,
  };
}

export function buildRotationHistoryInserts(input: {
  employees: DutyRosterEmployee[];
  projects: DutyRosterProject[];
  history: RosterHistoryRecord[];
  config: RosterConfigRecord;
  generatedBy: string;
  generatedDate: string;
}): {
  inserts: Array<Omit<RosterHistoryRecord, "roster_number"> & { roster_number: string }>;
  nextCycleStartDate: string;
  nextRotationNumber: number;
} {
  const activeEmployees = input.employees.filter(
    (employee) => employee.employment_status === ACTIVE_EMPLOYMENT_STATUS,
  );
  const latestByEmployee = getLatestHistoryByEmployee(input.history);
  const rotationDates = calculateRotationDates(input.config);
  const nextCycleStartDate = rotationDates.nextRotationDate;
  const nextCycleEndDate = formatIsoDate(
    addDays(parseIsoDate(nextCycleStartDate), input.config.cycle_length_days - 1),
  );
  const nextRotationNumber = getCurrentRotationNumber(input.history) + 1;
  let rosterCounter = getNextRosterNumber(
    input.history.map((row) => row.roster_number),
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
