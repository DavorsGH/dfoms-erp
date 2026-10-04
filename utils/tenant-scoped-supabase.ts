import type { SupabaseClient } from "@supabase/supabase-js";

export function assertTenantIdForMutation(tenantId: string | null | undefined): string {
  const trimmed = tenantId?.trim();
  if (!trimmed) {
    throw new Error("Tenant context is required for this action.");
  }

  return trimmed;
}

type StringKeyFilters = Record<string, string | number | boolean | null>;

export function tenantScopedDelete(
  supabase: SupabaseClient,
  table: string,
  tenantId: string,
  filters: StringKeyFilters,
) {
  let query = supabase.from(table).delete().eq("tenant_id", tenantId);

  for (const [column, value] of Object.entries(filters)) {
    if (value === null) {
      query = query.is(column, null);
    } else {
      query = query.eq(column, value);
    }
  }

  return query;
}

export function tenantScopedUpdate(
  supabase: SupabaseClient,
  table: string,
  tenantId: string,
  values: Record<string, unknown>,
  filters: StringKeyFilters,
) {
  let query = supabase.from(table).update(values).eq("tenant_id", tenantId);

  for (const [column, value] of Object.entries(filters)) {
    if (value === null) {
      query = query.is(column, null);
    } else {
      query = query.eq(column, value);
    }
  }

  return query;
}
