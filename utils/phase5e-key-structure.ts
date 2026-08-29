/**
 * Phase 5e key-structure helpers for tax_settings, month_end_close,
 * manual_financial_entries (and payroll_link schema).
 *
 * Null business_unit_id = default/legacy (workspace) row. Aggregate "All
 * Businesses" is a separate view flag — see `@/utils/business-unit-view`.
 *
 * This module is client-safe (no next/headers). Server-only lock helpers live in
 * `@/utils/phase5e-lock`.
 */

export {
  LOCK_REQUIRES_SCOPED_BU_MESSAGE,
  LOCK_REQUIRES_SPECIFIC_BU_MESSAGE,
} from "@/utils/business-unit-view";

export const TAX_SETTINGS_ON_CONFLICT = "tenant_id,business_unit_id" as const;
export const MONTH_END_CLOSE_ON_CONFLICT =
  "tenant_id,business_unit_id,month" as const;
export const MANUAL_FINANCIAL_ENTRIES_ON_CONFLICT =
  "tenant_id,business_unit_id,period_month" as const;
export const PAYROLL_LINK_ON_CONFLICT =
  "tenant_id,business_unit_id,payroll_month" as const;

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
 * When filtering reads for UI scoped context:
 * - concrete BU → that BU only
 * - null (workspace default) → null default row
 * Aggregate "All Businesses" must not use this — callers sum all rows instead.
 */
export function scopeTaxSettingsRead<T>(
  query: T,
  activeBusinessUnitId: string | null,
): T {
  return scopeToBusinessUnitId(query, activeBusinessUnitId);
}
