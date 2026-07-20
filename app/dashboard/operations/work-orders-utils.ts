export type WorkOrderEntry = {
  work_order_no: string;
  checklist_id: string | null;
  ref_po_no: string | null;
  date: string;
  client_id: string | null;
  site_id: string | null;
  area: string | null;
  service_type: string | null;
  assigned_cleaner: string | null;
  supervisor: string | null;
  start_time: string | null;
  completion_time: string | null;
  duration_min: number | null;
  inspection_score_pct: number | null;
  pass_fail: string | null;
  checked_by_sup: boolean | null;
  remarks: string | null;
  client?: {
    client_id: string;
    client_name: string;
  } | null;
  site?: {
    site_code: string;
    site_name: string;
  } | null;
};

export const WORK_ORDER_SELECT =
  "*, client:customers!work_orders_client_id_fkey(client_id, client_name), site:sites!work_orders_site_id_fkey(site_code, site_name)";

export function normalizeSiteRelation(
  site:
    | WorkOrderEntry["site"]
    | NonNullable<WorkOrderEntry["site"]>[]
    | null
    | undefined,
): WorkOrderEntry["site"] {
  if (Array.isArray(site)) {
    return site[0] ?? null;
  }

  return site ?? null;
}

export function normalizeClientRelation(
  client:
    | WorkOrderEntry["client"]
    | NonNullable<WorkOrderEntry["client"]>[]
    | null
    | undefined,
): WorkOrderEntry["client"] {
  if (Array.isArray(client)) {
    return client[0] ?? null;
  }

  return client ?? null;
}

export function normalizeWorkOrderEntry(raw: WorkOrderEntry): WorkOrderEntry {
  return {
    ...raw,
    client: normalizeClientRelation(raw.client),
    site: normalizeSiteRelation(raw.site),
  };
}

export function getWorkOrderClientName(entry: WorkOrderEntry): string {
  return entry.client?.client_name ?? entry.client_id ?? "—";
}

export function getWorkOrderSiteName(entry: WorkOrderEntry): string {
  return entry.site?.site_name ?? entry.site_id ?? "—";
}
