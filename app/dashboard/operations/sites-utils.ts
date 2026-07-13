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
  client?: {
    client_id: string;
    client_name: string;
  } | null;
};

export const SITE_SELECT =
  "*, client:clients!client_id(client_id, client_name)";

export function getSiteClientName(site: SiteEntry): string {
  return site.client?.client_name ?? site.client_id ?? "—";
}

export function getSiteBuildingZone(site: SiteEntry): string {
  const parts = [site.building, site.floor_zone].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "—";
}
