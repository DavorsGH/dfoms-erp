import type { SiteEntry } from "../operations/sites-utils";

export type ProjectSite = {
  site_code: string;
  site_name: string;
  client_id: string | null;
  required_staff?: number | null;
  project_id?: string | null;
  client?: {
    client_id: string;
    client_name: string;
  } | null;
};

export type ProjectEntry = {
  id: string;
  project_code: string;
  project_name: string;
  required_staff?: number | null;
  sites?: ProjectSite[] | null;
};

export const PROJECT_SELECT =
  "id, project_code, project_name, required_staff, sites:sites!sites_project_id_fkey(site_code, site_name, client_id, required_staff, project_id)";

export const CONTRACT_PROJECT_SELECT = "id, project_code, project_name";

export type ContractProjectOption = {
  id: string;
  project_code: string;
  project_name: string;
};

export function normalizeProjectEntry(raw: ProjectEntry): ProjectEntry {
  const sites = Array.isArray(raw.sites)
    ? raw.sites.map((site) => ({
        ...site,
        client: Array.isArray(site.client)
          ? site.client[0] ?? null
          : site.client ?? null,
      }))
    : raw.sites ?? null;

  return {
    ...raw,
    sites,
  };
}

export function getProjectSiteCount(project: ProjectEntry): number {
  return project.sites?.length ?? 0;
}

export function getProjectSiteLabel(project: ProjectEntry): string {
  const count = getProjectSiteCount(project);
  if (count === 0) {
    return "—";
  }

  if (count === 1) {
    return project.sites?.[0]?.site_name ?? "—";
  }

  return `${count} sites`;
}

export function getProjectClientName(
  project: ProjectEntry,
  sites: SiteEntry[],
): string {
  const linkedSites =
    project.sites ??
    sites.filter((site) => site.project_id === project.id);

  const clientIds = new Set(
    linkedSites.map((site) => site.client_id).filter(Boolean) as string[],
  );

  if (clientIds.size === 1) {
    const clientId = [...clientIds][0];
    const site = linkedSites.find((entry) => entry.client_id === clientId);
    return site?.client?.client_name ?? clientId;
  }

  if (clientIds.size > 1) {
    return "Multiple clients";
  }

  return "Unassigned";
}
