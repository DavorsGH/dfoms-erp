export type ComplaintRegisterEntry = {
  complaint_no: string;
  date_received: string;
  client_id: string | null;
  site_id: string | null;
  area: string | null;
  complaint_details: string | null;
  priority: string | null;
  assigned_supervisor: string | null;
  action_taken: string | null;
  status: string | null;
  resolution_date: string | null;
  customer_satisfaction: string | null;
  repeat_complaint: boolean | null;
  notes: string | null;
  client?: {
    client_id: string;
    client_name: string;
  } | null;
  site?: {
    site_code: string;
    site_name: string;
  } | null;
};

export const COMPLAINT_REGISTER_SELECT =
  "*, client:customers!client_id(client_id, client_name), site:sites!site_id(site_code, site_name)";

export function normalizeComplaintRegisterEntry(
  raw: ComplaintRegisterEntry,
): ComplaintRegisterEntry {
  return {
    ...raw,
    client: Array.isArray(raw.client) ? raw.client[0] ?? null : raw.client ?? null,
    site: Array.isArray(raw.site) ? raw.site[0] ?? null : raw.site ?? null,
  };
}

export function getComplaintClientName(entry: ComplaintRegisterEntry): string {
  return entry.client?.client_name ?? entry.client_id ?? "—";
}

export function getComplaintSiteName(entry: ComplaintRegisterEntry): string {
  return entry.site?.site_name ?? entry.site_id ?? "—";
}
