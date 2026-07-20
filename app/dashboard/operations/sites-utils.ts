export type SiteProject = {
  id: string;
  project_code: string;
  project_name: string;
};

export type SiteEntry = {
  site_code: string;
  client_id: string | null;
  site_name: string;
  building: string | null;
  floor_zone: string | null;
  area_room: string | null;
  cleaning_frequency: string | null;
  risk_level: string | null;
  est_cleaning_time_min: number | null;
  assigned_supervisor: string | null;
  access_instructions: string | null;
  notes: string | null;
  required_staff: number | null;
  project_id: string | null;
  client?: {
    client_id: string;
    client_name: string;
  } | null;
  project?: SiteProject | null;
};

export const SITE_SELECT =
  "*, client:customers!sites_client_id_fkey(client_id, client_name), project:projects!project_id(id, project_code, project_name)";

export const SITE_ASSIGNMENT_SELECT =
  "site_code, site_name, client_id, building, floor_zone, area_room, cleaning_frequency, risk_level, required_staff, project_id, assigned_supervisor, notes, client:customers!sites_client_id_fkey(client_id, client_name), project:projects!project_id(id, project_code, project_name)";

export function normalizeSiteEntry(raw: SiteEntry): SiteEntry {
  const client = Array.isArray(raw.client)
    ? raw.client[0] ?? null
    : raw.client ?? null;
  const project = Array.isArray(raw.project)
    ? raw.project[0] ?? null
    : raw.project ?? null;

  return {
    ...raw,
    client,
    project,
  };
}

export function getSiteClientName(site: SiteEntry): string {
  return site.client?.client_name ?? site.client_id ?? "—";
}

export function getSiteBuildingZone(site: SiteEntry): string {
  const parts = [site.building, site.floor_zone].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "—";
}

export function isRosterStaffingSite(
  site: Pick<SiteEntry, "required_staff">,
): boolean {
  return site.required_staff != null;
}
