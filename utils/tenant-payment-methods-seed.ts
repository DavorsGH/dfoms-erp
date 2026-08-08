import type { SupabaseClient } from "@supabase/supabase-js";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

/**
 * One-time-style seed: copy Davors' current payment_methods names to a tenant
 * that has none yet. Existing tenant rows are never modified or deleted.
 */
export async function seedTenantPaymentMethodsFromDavorsTemplate(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ inserted: number; skipped: boolean; error: string | null }> {
  const { count, error: countError } = await admin
    .from("payment_methods")
    .select("name", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (countError) {
    return { inserted: 0, skipped: false, error: countError.message };
  }

  if ((count ?? 0) > 0) {
    return { inserted: 0, skipped: true, error: null };
  }

  const { data: templateRows, error: templateError } = await admin
    .from("payment_methods")
    .select("name")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .order("name", { ascending: true });

  if (templateError) {
    return { inserted: 0, skipped: false, error: templateError.message };
  }

  if (!templateRows?.length) {
    return {
      inserted: 0,
      skipped: false,
      error: "Davors payment_methods template is empty.",
    };
  }

  const payload = templateRows.map((row) => ({
    tenant_id: tenantId,
    name: row.name,
  }));

  const { error: insertError } = await admin.from("payment_methods").insert(payload);

  if (insertError) {
    return { inserted: 0, skipped: false, error: insertError.message };
  }

  return { inserted: payload.length, skipped: false, error: null };
}
