/**
 * Phase 5e key-structure helpers for tax_settings, month_end_close,
 * manual_financial_entries (and payroll_link schema).
 *
 * Null business_unit_id = default/legacy row (tenants with no BUs, or writes
 * while "All Businesses" is selected — except Lock Period gate in phase5e-lock).
 *
 * This module is client-safe (no next/headers). Server-only lock helpers live in
 * `@/utils/phase5e-lock`.
 */

export const TAX_SETTINGS_ON_CONFLICT = "tenant_id,business_unit_id" as const;
export const MONTH_END_CLOSE_ON_CONFLICT =
  "tenant_id,business_unit_id,month" as const;
export const MANUAL_FINANCIAL_ENTRIES_ON_CONFLICT =
  "tenant_id,business_unit_id,period_month" as const;
export const PAYROLL_LINK_ON_CONFLICT =
  "tenant_id,business_unit_id,payroll_month" as const;

export const LOCK_REQUIRES_SPECIFIC_BU_MESSAGE =
  "Select a specific business before locking payroll. Locking while All Businesses is selected is not allowed when this workspace has business units.";

/**
 * Scope a Supabase query to one BU row, or the null default row.
 * Input type is preserved; internals use a loose cast to avoid Postgrest TS2589.
 */
export function scopeToBusinessUnitId<T>(
  query: T,
  businessUnitId: string | null,
): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  if (businessUnitId) {
    return q.eq("business_unit_id", businessUnitId) as T;
  }
  return q.is("business_unit_id", null) as T;
}

/**
 * When filtering reads for UI "current context":
 * - concrete BU → that BU only
 * - null (All Businesses) → for config tables prefer null default row;
 *   for aggregates callers should omit this and sum all rows instead.
 */
export function scopeTaxSettingsRead<T>(
  query: T,
  activeBusinessUnitId: string | null,
): T {
  // Config: All Businesses edits/reads the null default row (zero-BU path).
  return scopeToBusinessUnitId(query, activeBusinessUnitId);
}
