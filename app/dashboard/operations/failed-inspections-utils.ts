export type FailedInspectionEntry = {
  issue_no: string;
  checklist_id: string | null;
  date_identified: string;
  client_id: string | null;
  site_id: string | null;
  area: string | null;
  problem_description: string | null;
  severity: string | null;
  assigned_person: string | null;
  target_date: string | null;
  completed: boolean | null;
  date_closed: string | null;
  client?: {
    client_id: string;
    client_name: string;
  } | null;
  site?: {
    site_code: string;
    site_name: string;
  } | null;
};

export const FAILED_INSPECTION_SELECT =
  "*, client:customers!failed_inspections_client_id_fkey(client_id, client_name), site:sites!failed_inspections_site_id_fkey(site_code, site_name)";

export type InspectionChecklistLookup = {
  checklist_id: string;
  inspection_date: string;
  client_id: string | null;
  site_id: string | null;
};

export function normalizeFailedInspectionEntry(
  raw: FailedInspectionEntry,
): FailedInspectionEntry {
  return {
    ...raw,
    client: Array.isArray(raw.client) ? raw.client[0] ?? null : raw.client ?? null,
    site: Array.isArray(raw.site) ? raw.site[0] ?? null : raw.site ?? null,
  };
}

export function getFailedInspectionClientName(entry: FailedInspectionEntry): string {
  return entry.client?.client_name ?? entry.client_id ?? "—";
}

export function getFailedInspectionSiteName(entry: FailedInspectionEntry): string {
  return entry.site?.site_name ?? entry.site_id ?? "—";
}

export function isFailedInspectionOverdue(entry: FailedInspectionEntry): boolean {
  if (entry.completed) {
    return false;
  }

  if (!entry.target_date?.trim()) {
    return false;
  }

  const dueDate = new Date(entry.target_date.slice(0, 10));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return dueDate < today;
}
