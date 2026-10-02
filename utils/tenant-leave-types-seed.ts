import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAVE_ENTITLEMENT_TYPES } from "@/app/dashboard/administration/leave-entitlement-policy-utils";

export type PlatformLeaveTypeSeedRow = {
  type_name: (typeof LEAVE_ENTITLEMENT_TYPES)[number];
  default_annual_entitlement: number | null;
};

export const PLATFORM_LEAVE_TYPE_SEED_ROWS: PlatformLeaveTypeSeedRow[] = [
  { type_name: "Annual Leave", default_annual_entitlement: 15 },
  { type_name: "Sick Leave", default_annual_entitlement: null },
  { type_name: "Unpaid Leave", default_annual_entitlement: 0 },
];

export async function seedTenantLeaveTypesIfMissing(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ inserted: number; skipped: boolean; error: string | null }> {
  const { data: existing, error: existingError } = await admin
    .from("leave_types")
    .select("type_name")
    .eq("tenant_id", tenantId);

  if (existingError) {
    return { inserted: 0, skipped: false, error: existingError.message };
  }

  const have = new Set(
    (existing ?? []).map((row) => String(row.type_name ?? "").trim()),
  );

  const missing = PLATFORM_LEAVE_TYPE_SEED_ROWS.filter(
    (row) => !have.has(row.type_name),
  );

  if (missing.length === 0) {
    return { inserted: 0, skipped: true, error: null };
  }

  const payload = missing.map((row) => ({
    tenant_id: tenantId,
    type_name: row.type_name,
    default_annual_entitlement: row.default_annual_entitlement,
  }));

  const { error: insertError } = await admin.from("leave_types").insert(payload);

  if (insertError) {
    return { inserted: 0, skipped: false, error: insertError.message };
  }

  return { inserted: payload.length, skipped: false, error: null };
}
