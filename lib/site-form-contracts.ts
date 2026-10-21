import {
  buildStaffGroups,
  staffGroupIsSelectable,
  withSiteCounts,
  type StaffGroupProject,
} from "@/lib/attendance-staff-groups";

export type SiteFormProject = StaffGroupProject & {
  id: string;
  contract_type?: string | null;
};

export type SiteFormContractChoice = {
  groupKey: string;
  label: string;
  clientId: string | null;
  anchorProjectId: string;
  projectCodes: string[];
  dataIssue: string | null;
};

function distinctClientIds(
  sites: Array<{ client_id: string | null; project_code: string | null }>,
): string[] {
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
 * Active Contract and Ad hoc groups, including ones that do not have a site yet.
 * client_id comes from the service contract's customer, otherwise the one
 * customer already used by that contract's sites.
 */
export function listSiteFormContractChoices(input: {
  projects: SiteFormProject[];
  sites: Array<{ client_id: string | null; project_code: string | null }>;
  serviceContracts: Array<{ id: string; client_id: string | null }>;
}): SiteFormContractChoice[] {
  const eligible = input.projects.filter((project) => {
    const type = project.contract_type ?? "contract";
    return type === "contract" || type === "adhoc";
  });
  const counted = withSiteCounts(
    eligible,
    input.sites.map((site) => site.project_code),
  );
  const groups = buildStaffGroups(counted).filter((group) =>
    staffGroupIsSelectable(group, counted),
  );
  const contractClients = new Map(
    input.serviceContracts.map((contract) => [
      contract.id,
      contract.client_id?.trim() ?? "",
    ]),
  );

  const choices: SiteFormContractChoice[] = [];
  for (const group of groups) {
    const anchor = counted.find(
      (project) => project.project_code === group.anchorProjectCode,
    ) as SiteFormProject | undefined;
    const anchorProjectId = anchor?.id?.trim() ?? "";
    if (!anchorProjectId) {
      continue;
    }

    const codes = new Set(group.projectCodes);
    const groupSites = input.sites.filter((site) =>
      codes.has(site.project_code?.trim() ?? ""),
    );
    const serviceClient = group.key.startsWith("contract:")
      ? (contractClients.get(group.key.slice("contract:".length)) ?? "")
      : "";
    const siteClients = distinctClientIds(groupSites);

    let clientId: string | null = null;
    let dataIssue: string | null = null;
    if (serviceClient) {
      clientId = serviceClient;
    } else if (siteClients.length === 1) {
      clientId = siteClients[0] ?? null;
    } else if (siteClients.length === 0) {
      dataIssue = `${group.label} has no customer on a service contract or on its sites, so a site cannot be saved for it yet.`;
    } else {
      dataIssue = `${group.label} has sites on more than one customer (${siteClients.join(", ")}). A site cannot be saved until those sites share one customer.`;
    }

    choices.push({
      groupKey: group.key,
      label: group.label,
      clientId,
      anchorProjectId,
      projectCodes: group.projectCodes,
      dataIssue,
    });
  }

  return choices;
}
