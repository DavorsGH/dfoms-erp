/** Device option: all staff. attendance_devices.contract_project stays NULL. */
export const COMPANY_WIDE_STAFF_GROUP = "__company_wide__";

/**
 * The staff group that contains the project named "Davors Office".
 * That project has no service contract, so the group is that project alone.
 */
export const DAVORS_OWN_STAFF_GROUP = "__davors_own__";

export const COMPANY_WIDE_STAFF_LABEL = "Davors — company-wide (all staff)";
export const DAVORS_OWN_STAFF_LABEL = "Davors own staff";

const OFFICE_PROJECT_NAME = "davors office";

export type StaffGroupProject = {
  project_code: string;
  project_name: string;
  is_archived?: boolean | null;
  service_contract_id?: string | null;
  /** Sites whose project_id points at this project. Used to choose the anchor. */
  site_count?: number | null;
};

export type StaffGroup = {
  /** `contract:<service_contract_id>` or `project:<project_code>`. */
  key: string;
  label: string;
  anchorProjectCode: string;
  projectCodes: string[];
  isOffice: boolean;
};

export function isDavorsOfficeProject(project: {
  project_name: string | null | undefined;
}): boolean {
  return (project.project_name ?? "").trim().toLowerCase() === OFFICE_PROJECT_NAME;
}

export function staffGroupKeyForProject(
  projectCode: string | null | undefined,
  projects: StaffGroupProject[],
): string | null {
  const code = projectCode?.trim() ?? "";
  if (!code) {
    return null;
  }
  const project = projects.find((entry) => entry.project_code === code);
  if (!project) {
    return `project:${code}`;
  }
  const contractId = project.service_contract_id?.trim() ?? "";
  return contractId ? `contract:${contractId}` : `project:${project.project_code}`;
}

function lowestProjectCode(projects: StaffGroupProject[]): StaffGroupProject {
  return [...projects].sort((left, right) =>
    left.project_code.localeCompare(right.project_code),
  )[0]!;
}

/** Site-owning project in the set, otherwise the lowest project_code. */
export function anchorProject(projects: StaffGroupProject[]): StaffGroupProject {
  const active = projects.filter((project) => project.is_archived !== true);
  const pool = active.length > 0 ? active : projects;
  const activeOwners = pool.filter((project) => (project.site_count ?? 0) > 0);
  if (activeOwners.length > 0) {
    return lowestProjectCode(activeOwners);
  }
  const anyOwners = projects.filter((project) => (project.site_count ?? 0) > 0);
  if (anyOwners.length > 0) {
    return lowestProjectCode(anyOwners);
  }
  return lowestProjectCode(pool);
}

/**
 * One group per service contract. Projects with no service_contract_id are
 * their own group. Archived-only sets are omitted from the list, but a live
 * contract still includes its archived sibling project codes for membership.
 * Label is the anchor project's name (service contracts have no name column;
 * the anchor is the project that owns the sites, e.g. Central University).
 */
export function buildStaffGroups(
  projects: StaffGroupProject[],
  contractLabels?: ReadonlyMap<string, string>,
): StaffGroup[] {
  const buckets = new Map<string, StaffGroupProject[]>();
  for (const project of projects) {
    const key = staffGroupKeyForProject(project.project_code, projects);
    if (!key) {
      continue;
    }
    const list = buckets.get(key) ?? [];
    list.push(project);
    buckets.set(key, list);
  }

  const groups: StaffGroup[] = [];
  for (const [key, members] of buckets) {
    if (!members.some((project) => project.is_archived !== true)) {
      continue;
    }
    const anchor = anchorProject(members);
    const contractId = key.startsWith("contract:") ? key.slice("contract:".length) : "";
    const contractLabel = contractId ? contractLabels?.get(contractId)?.trim() : "";
    groups.push({
      key,
      label: contractLabel || anchor.project_name,
      anchorProjectCode: anchor.project_code,
      projectCodes: members.map((project) => project.project_code),
      isOffice: members.some((project) => isDavorsOfficeProject(project)),
    });
  }

  groups.sort((left, right) => left.label.localeCompare(right.label));
  return groups;
}

/** Dropdowns offer a group only while its anchor project is still active. */
export function staffGroupIsSelectable(
  group: Pick<StaffGroup, "anchorProjectCode">,
  projects: StaffGroupProject[],
): boolean {
  const anchor = projects.find(
    (project) => project.project_code === group.anchorProjectCode,
  );
  return Boolean(anchor && anchor.is_archived !== true);
}

export function findStaffGroup(
  groupKey: string,
  projects: StaffGroupProject[],
  contractLabels?: ReadonlyMap<string, string>,
): StaffGroup | null {
  if (groupKey === DAVORS_OWN_STAFF_GROUP) {
    return (
      buildStaffGroups(projects, contractLabels).find((group) => group.isOffice) ??
      null
    );
  }
  return (
    buildStaffGroups(projects, contractLabels).find((group) => group.key === groupKey) ??
    null
  );
}

export function projectsShareStaffGroup(
  leftProject: string | null | undefined,
  rightProject: string | null | undefined,
  projects: StaffGroupProject[],
): boolean {
  const left = staffGroupKeyForProject(leftProject, projects);
  const right = staffGroupKeyForProject(rightProject, projects);
  return left != null && left === right;
}

export function deviceStaffGroupLabel(
  device: { company_wide?: boolean | null; contract_project?: string | null },
  projects: StaffGroupProject[],
  contractLabels?: ReadonlyMap<string, string>,
): string {
  if (device.company_wide) {
    return COMPANY_WIDE_STAFF_LABEL;
  }
  const key = staffGroupKeyForProject(device.contract_project, projects);
  if (!key) {
    return "";
  }
  const label = findStaffGroup(key, projects, contractLabels)?.label;
  if (label) {
    return label;
  }
  const stored = device.contract_project?.trim() ?? "";
  const project = projects.find((entry) => entry.project_code === stored);
  return project?.project_name ?? stored;
}

export function employeeMatchesStaffGroup(
  contractProject: string | null | undefined,
  group: string,
  projects: StaffGroupProject[],
): boolean {
  if (!group || group === "all") {
    return true;
  }
  const employeeKey = staffGroupKeyForProject(contractProject, projects);
  if (!employeeKey) {
    return false;
  }
  if (group === DAVORS_OWN_STAFF_GROUP) {
    const office = findStaffGroup(DAVORS_OWN_STAFF_GROUP, projects);
    return office != null && employeeKey === office.key;
  }
  return employeeKey === group;
}

export function withSiteCounts(
  projects: StaffGroupProject[],
  siteProjectCodes: Array<string | null | undefined>,
): StaffGroupProject[] {
  const counts = new Map<string, number>();
  for (const code of siteProjectCodes) {
    const trimmed = code?.trim() ?? "";
    if (!trimmed) {
      continue;
    }
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  return projects.map((project) => ({
    ...project,
    site_count: counts.get(project.project_code) ?? 0,
  }));
}
