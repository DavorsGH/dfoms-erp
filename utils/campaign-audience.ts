import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeAudienceFilter,
  type CampaignAudienceFilter,
  type CampaignCustomer,
} from "@/utils/campaigns-types";

export const CAMPAIGN_AUDIENCE_CUSTOMER_SELECT =
  "client_id, client_name, contact_person, phone, email, address, customer_type, status" as const;

const ALLOWED_FILTER_CUSTOMER_TYPES = new Set([
  "service_client",
  "digital_subscriber",
  "product_client",
  "all",
]);

function mergeCustomers(
  into: Map<string, CampaignCustomer>,
  rows: CampaignCustomer[],
) {
  for (const row of rows) {
    into.set(row.client_id, row);
  }
}

function coerceAudience(
  audience: CampaignAudienceFilter | unknown,
): CampaignAudienceFilter {
  return (
    normalizeAudienceFilter(audience) ??
    (audience as CampaignAudienceFilter)
  );
}

async function fetchActiveCustomersByCustomerTypes(
  supabase: SupabaseClient,
  tenantId: string,
  customerTypes: string[],
): Promise<CampaignCustomer[]> {
  const types = customerTypes.filter((t) => ALLOWED_FILTER_CUSTOMER_TYPES.has(t));
  if (types.length === 0) return [];

  const { data, error } = await supabase
    .from("customers")
    .select(CAMPAIGN_AUDIENCE_CUSTOMER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("customer_type", types);

  if (error) {
    throw new Error(error.message);
  }
  return (data as CampaignCustomer[] | null) ?? [];
}

async function fetchActiveCustomersByClientIds(
  supabase: SupabaseClient,
  tenantId: string,
  clientIds: string[],
): Promise<CampaignCustomer[]> {
  if (clientIds.length === 0) return [];

  const chunkSize = 200;
  const merged: CampaignCustomer[] = [];

  for (let i = 0; i < clientIds.length; i += chunkSize) {
    const chunk = clientIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("customers")
      .select(CAMPAIGN_AUDIENCE_CUSTOMER_SELECT)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .in("client_id", chunk);

    if (error) {
      throw new Error(error.message);
    }
    merged.push(...((data as CampaignCustomer[] | null) ?? []));
  }

  return merged;
}

/**
 * Resolve campaign audience customers (active only, tenant-scoped).
 * `filtered` = OR-union of customer_types ∪ client_ids, de-duplicated by client_id.
 * Legacy `customer_type` and `all` shapes are supported unchanged.
 */
export async function loadCampaignCustomers(
  supabase: SupabaseClient,
  tenantId: string,
  audienceInput: CampaignAudienceFilter | unknown,
): Promise<CampaignCustomer[]> {
  const audience = coerceAudience(audienceInput);

  if (audience.type === "all") {
    const { data, error } = await supabase
      .from("customers")
      .select(CAMPAIGN_AUDIENCE_CUSTOMER_SELECT)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("client_name", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }
    return (data as CampaignCustomer[] | null) ?? [];
  }

  if (audience.type === "customer_type") {
    const { data, error } = await supabase
      .from("customers")
      .select(CAMPAIGN_AUDIENCE_CUSTOMER_SELECT)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .eq("customer_type", audience.value);

    if (error) {
      throw new Error(error.message);
    }
    return (data as CampaignCustomer[] | null) ?? [];
  }

  if (audience.type !== "filtered") {
    return [];
  }

  const byId = new Map<string, CampaignCustomer>();

  const [byType, byIndividual] = await Promise.all([
    fetchActiveCustomersByCustomerTypes(
      supabase,
      tenantId,
      audience.customer_types,
    ),
    fetchActiveCustomersByClientIds(supabase, tenantId, audience.client_ids),
  ]);

  mergeCustomers(byId, byType);
  mergeCustomers(byId, byIndividual);

  return [...byId.values()].sort((a, b) => {
    const nameA = (a.client_name ?? a.client_id).toLocaleLowerCase();
    const nameB = (b.client_name ?? b.client_id).toLocaleLowerCase();
    return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
  });
}

export async function countCampaignAudienceRecipients(
  supabase: SupabaseClient,
  tenantId: string,
  audienceInput: CampaignAudienceFilter | unknown,
): Promise<number> {
  try {
    const customers = await loadCampaignCustomers(
      supabase,
      tenantId,
      audienceInput,
    );
    return customers.length;
  } catch (error) {
    console.error(
      "[campaigns] audience count failed:",
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}

/** Drop client IDs that are not active customers in this tenant. */
export async function sanitizeFilteredClientIds(
  supabase: SupabaseClient,
  tenantId: string,
  clientIds: string[],
): Promise<string[]> {
  if (clientIds.length === 0) return [];

  const rows = await fetchActiveCustomersByClientIds(
    supabase,
    tenantId,
    clientIds,
  );
  const allowed = new Set(rows.map((row) => row.client_id));
  return clientIds.filter((id) => allowed.has(id));
}
