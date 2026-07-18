export type InspectionSummaryEntry = {
  checklist_id: string;
  inspection_date: string;
  work_order_no: string | null;
  client_id: string | null;
  site_id: string | null;
  supervisor: string | null;
  inspection_score_pct: number | null;
  pass_fail: string | null;
  critical_findings: string | null;
  recommendations: string | null;
  next_inspection_date: string | null;
  status: string | null;
  client?: {
    client_id: string;
    client_name: string;
  } | null;
  site?: {
    site_code: string;
    site_name: string;
  } | null;
};

export const INSPECTION_SUMMARY_SELECT =
  "*, client:customers!client_id(client_id, client_name), site:sites!site_id(site_code, site_name)";

export type WorkOrderLookup = {
  work_order_no: string;
  date: string;
  client_id: string | null;
  site_id: string | null;
};

export function normalizeInspectionSummaryEntry(
  raw: InspectionSummaryEntry,
): InspectionSummaryEntry {
  return {
    ...raw,
    client: Array.isArray(raw.client) ? raw.client[0] ?? null : raw.client ?? null,
    site: Array.isArray(raw.site) ? raw.site[0] ?? null : raw.site ?? null,
  };
}

export function getInspectionClientName(entry: InspectionSummaryEntry): string {
  return entry.client?.client_name ?? entry.client_id ?? "—";
}

export function getInspectionSiteName(entry: InspectionSummaryEntry): string {
  return entry.site?.site_name ?? entry.site_id ?? "—";
}
