export type IncidentRegisterEntry = {
  incident_no: string;
  date: string;
  time: string | null;
  client_id: string | null;
  site_id: string | null;
  area: string | null;
  incident_type: string | null;
  description: string | null;
  severity: string | null;
  reported_by: string | null;
  action_taken: string | null;
  status: string | null;
  date_resolved: string | null;
  escalated_to_mgmt: boolean | null;
  notes: string | null;
  client?: {
    client_id: string;
    client_name: string;
  } | null;
  site?: {
    site_code: string;
    site_name: string;
  } | null;
  reporter?: {
    employee_id: string;
    full_name: string;
  } | null;
};

export const INCIDENT_REGISTER_SELECT =
  "*, client:customers!incident_register_client_id_fkey(client_id, client_name), site:sites!incident_register_site_id_fkey(site_code, site_name), reporter:employees!incident_register_reported_by_fkey(employee_id, full_name)";

export function normalizeIncidentRegisterEntry(
  raw: IncidentRegisterEntry,
): IncidentRegisterEntry {
  return {
    ...raw,
    client: Array.isArray(raw.client) ? raw.client[0] ?? null : raw.client ?? null,
    site: Array.isArray(raw.site) ? raw.site[0] ?? null : raw.site ?? null,
    reporter: Array.isArray(raw.reporter)
      ? raw.reporter[0] ?? null
      : raw.reporter ?? null,
  };
}

export function getIncidentClientName(entry: IncidentRegisterEntry): string {
  return entry.client?.client_name ?? entry.client_id ?? "—";
}

export function getIncidentSiteName(entry: IncidentRegisterEntry): string {
  return entry.site?.site_name ?? entry.site_id ?? "—";
}

export function getIncidentReporterName(entry: IncidentRegisterEntry): string {
  return entry.reporter?.full_name ?? entry.reported_by ?? "—";
}

export function isIncidentOpen(entry: IncidentRegisterEntry): boolean {
  const status = (entry.status ?? "").trim().toLowerCase();
  return status !== "completed" && status !== "resolved";
}

export function calculateIncidentDaysOpen(
  entry: IncidentRegisterEntry,
  referenceDate = new Date(),
): number | null {
  if (!isIncidentOpen(entry)) {
    return null;
  }

  const raised = entry.date?.slice(0, 10);
  if (!raised) {
    return null;
  }

  const start = new Date(`${raised}T12:00:00`);
  const end = new Date(referenceDate);
  end.setHours(12, 0, 0, 0);
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}
