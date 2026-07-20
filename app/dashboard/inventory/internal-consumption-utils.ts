export type InternalConsumptionSite = {
  site_code: string;
  site_name: string;
  client_id: string | null;
  project_id?: string | null;
  client?: {
    client_id: string;
    client_name: string;
  } | null;
};

export type InternalConsumptionRecord = {
  id: string;
  product_id: string;
  quantity: number;
  consumption_date: string;
  reason: string | null;
  recorded_by: string | null;
  notes: string | null;
  created_at: string;
  site_id: string | null;
  product?: {
    product_code: string;
    product_name: string;
    unit_of_measure: string;
  } | null;
  site?: InternalConsumptionSite | null;
};

export const INTERNAL_CONSUMPTION_SELECT =
  "id, product_id, quantity, consumption_date, reason, recorded_by, notes, created_at, site_id, product:finished_products!product_id(product_code, product_name, unit_of_measure), site:sites!internal_consumption_site_id_fkey(site_code, site_name, client_id, project_id, client:customers!sites_client_id_fkey(client_id, client_name))";

export function normalizeInternalConsumption(
  raw: InternalConsumptionRecord,
): InternalConsumptionRecord {
  const product = Array.isArray(raw.product)
    ? raw.product[0] ?? null
    : raw.product ?? null;
  const site = Array.isArray(raw.site) ? raw.site[0] ?? null : raw.site ?? null;
  const client = site?.client
    ? Array.isArray(site.client)
      ? site.client[0] ?? null
      : site.client
    : null;

  return {
    ...raw,
    quantity: Number(raw.quantity) || 0,
    product,
    site: site
      ? {
          ...site,
          client,
        }
      : null,
  };
}

export function getInternalConsumptionClientName(
  entry: Pick<InternalConsumptionRecord, "site">,
): string {
  return entry.site?.client?.client_name?.trim() || "—";
}

export function getInternalConsumptionSiteName(
  entry: Pick<InternalConsumptionRecord, "site" | "site_id">,
): string {
  return entry.site?.site_name?.trim() || "—";
}

export function filterInternalConsumptionSites<
  T extends { site_code: string; project_id?: string | null },
>(sites: T[], projectId: string | null | undefined): T[] {
  if (!projectId) {
    return sites;
  }

  return sites.filter((site) => site.project_id === projectId);
}
