/**
 * Read-path Operations BU scoping via sites -> projects.business_unit_id.
 *
 * Fact tables store site references in a column named `site_id` that FKs to
 * `sites.site_code` (not a UUID). Scoped helpers therefore return site_code values.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";

export type ScopedSiteCodesResult = {
  /** null = All Businesses — do not filter by site. */
  siteCodes: string[] | null;
  error: string | null;
};

/**
 * Resolve site_code values for the active business-unit read scope.
 * - all → null (caller skips .in filter)
 * - default / unit → sites whose project is in the BU-scoped projects set
 */
export async function fetchScopedSiteCodes(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<ScopedSiteCodesResult> {
  if (buScope.mode === "all") {
    return { siteCodes: null, error: null };
  }

  const { data: projects, error: projectsError } = await applyBusinessUnitScope(
    supabase.from("projects").select("id").eq("tenant_id", tenantId),
    buScope,
  );

  if (projectsError) {
    return { siteCodes: [], error: projectsError.message };
  }

  const projectIds = [
    ...new Set(
      ((projects as Array<{ id: string | null }> | null) ?? [])
        .map((row) => String(row.id ?? "").trim())
        .filter(Boolean),
    ),
  ];

  if (projectIds.length === 0) {
    return { siteCodes: [], error: null };
  }

  const { data: sites, error: sitesError } = await supabase
    .from("sites")
    .select("site_code")
    .eq("tenant_id", tenantId)
    .in("project_id", projectIds);

  if (sitesError) {
    return { siteCodes: [], error: sitesError.message };
  }

  const siteCodes = [
    ...new Set(
      ((sites as Array<{ site_code: string | null }> | null) ?? [])
        .map((row) => String(row.site_code ?? "").trim())
        .filter(Boolean),
    ),
  ];

  return { siteCodes, error: null };
}

/**
 * Apply site_id IN filter when scoped. Empty list → force no rows
 * (PostgREST treats `.in(_, [])` inconsistently).
 *
 * Note: column is named site_id but values are sites.site_code.
 */
export function applySiteIdScope<T>(
  query: T,
  siteCodes: string[] | null,
): T {
  if (siteCodes === null) {
    return query;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  if (siteCodes.length === 0) {
    return q.eq("site_id", "__no_scoped_sites__") as T;
  }
  return q.in("site_id", siteCodes) as T;
}

/**
 * Same as applySiteIdScope, but for the sites table primary key (`site_code`).
 */
export function applySiteCodeScope<T>(
  query: T,
  siteCodes: string[] | null,
): T {
  if (siteCodes === null) {
    return query;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  if (siteCodes.length === 0) {
    return q.eq("site_code", "__no_scoped_sites__") as T;
  }
  return q.in("site_code", siteCodes) as T;
}
