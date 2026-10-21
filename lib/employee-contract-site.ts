import {
  buildStaffGroups,
  findStaffGroup,
  staffGroupKeyForProject,
  type StaffGroupProject,
} from "@/lib/attendance-staff-groups";

export type ContractSiteProject = StaffGroupProject & {
  contract_type?: string | null;
};

export type ContractSiteRecord = {
  site_code: string;
  site_name: string;
  project_code: string | null;
};

export type ContractChoice = {
  groupKey: string;
  label: string;
  anchorProjectCode: string;
  contractType: "contract" | "adhoc";
  projectCodes: string[];
};

/**
 * A legacy per-site project is named exactly like a site that belongs to a
 * different project (PRJ10 "Trinity Hall" vs SI-003 owned by PRJ01).
 */
export function isLegacyPerSiteProject(
  project: { project_code: string; project_name: string },
  sites: Array<{ site_name: string; project_code: string | null }>,
): boolean {
  const name = project.project_name.trim().toLowerCase();
  if (!name) {
    return false;
  }
  return sites.some((site) => {
    if (site.site_name.trim().toLowerCase() !== name) {
      return false;
    }
    const owner = site.project_code?.trim() ?? "";
    return owner.length > 0 && owner !== project.project_code;
  });
}

export function contractTypeOf(
  project: { contract_type?: string | null } | null | undefined,
): "contract" | "adhoc" {
  return project?.contract_type === "adhoc" ? "adhoc" : "contract";
}

export function contractTypeLabel(contractType: "contract" | "adhoc"): string {
  return contractType === "adhoc" ? "Ad hoc" : "Contract";
}

export function listContractChoices(
  projects: ContractSiteProject[],
  sites: ContractSiteRecord[],
): ContractChoice[] {
  const counted = projects.map((project) => ({
    ...project,
    site_count: sites.filter((site) => site.project_code === project.project_code)
      .length,
  }));
  return buildStaffGroups(counted)
    .filter((group) => {
      const anchor = counted.find(
        (project) => project.project_code === group.anchorProjectCode,
      );
      if (!anchor || anchor.is_archived === true) {
        return false;
      }
      return !isLegacyPerSiteProject(anchor, sites);
    })
    .map((group) => {
      const anchor = counted.find(
        (project) => project.project_code === group.anchorProjectCode,
      );
      return {
        groupKey: group.key,
        label: group.label,
        anchorProjectCode: group.anchorProjectCode,
        contractType: contractTypeOf(anchor),
        projectCodes: group.projectCodes,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function sitesForContractGroup(
  choice: Pick<ContractChoice, "projectCodes"> | null | undefined,
  sites: ContractSiteRecord[],
): ContractSiteRecord[] {
  if (!choice) {
    return [];
  }
  const codes = new Set(choice.projectCodes);
  return sites
    .filter((site) => site.project_code != null && codes.has(site.project_code))
    .sort((left, right) => left.site_name.localeCompare(right.site_name));
}

export function contractGroupKeyForStoredProject(
  contractProject: string | null | undefined,
  projects: ContractSiteProject[],
): string {
  return staffGroupKeyForProject(contractProject, projects) ?? "";
}

/** A different service-contract group means the old site no longer applies. */
export function contractChangeClearsSite(input: {
  originalContractProject: string | null;
  selectedGroupKey: string;
  projects: ContractSiteProject[];
}): boolean {
  const selected = input.selectedGroupKey.trim();
  const original = input.originalContractProject?.trim() ?? "";
  if (!selected || !original) {
    return false;
  }
  const originalKey = staffGroupKeyForProject(original, input.projects);
  return Boolean(originalKey && originalKey !== selected);
}

/**
 * Keep the stored contract_project when the selected group is still the
 * employee's current group (PRJ10 stays PRJ10 until the user picks another
 * contract). A real change saves the group's anchor.
 */
export function contractProjectToPersist(input: {
  originalContractProject: string | null;
  selectedGroupKey: string;
  projects: ContractSiteProject[];
}): string | null {
  const selected = input.selectedGroupKey.trim();
  if (!selected) {
    return null;
  }
  const original = input.originalContractProject?.trim() ?? "";
  if (original) {
    const originalKey = staffGroupKeyForProject(original, input.projects);
    if (originalKey === selected) {
      return original;
    }
  }
  const group = findStaffGroup(selected, input.projects);
  return group?.anchorProjectCode ?? null;
}

export function contractLabelForStoredProject(
  contractProject: string | null | undefined,
  projects: ContractSiteProject[],
  sites: ContractSiteRecord[],
): string {
  const key = contractGroupKeyForStoredProject(contractProject, projects);
  if (!key) {
    return "";
  }
  const choice = listContractChoices(projects, sites).find(
    (entry) => entry.groupKey === key,
  );
  if (choice) {
    return choice.label;
  }
  const project = projects.find((entry) => entry.project_code === contractProject);
  return project?.project_name ?? contractProject ?? "";
}
