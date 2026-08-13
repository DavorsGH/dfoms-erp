import type { SupabaseClient } from "@supabase/supabase-js";

/** Generic payment-method names seeded for new tenants (excludes Crypto Currency). */
export const DEFAULT_TENANT_PAYMENT_METHOD_NAMES = [
  "Bank Transfer",
  "Cash",
  "Cheque",
  "Credit",
  "Mobile Money",
  "POS",
] as const;

/**
 * One-time-style seed: insert canonical payment method names for a tenant
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

  const payload = DEFAULT_TENANT_PAYMENT_METHOD_NAMES.map((name) => ({
    tenant_id: tenantId,
    name,
  }));

  const { error: insertError } = await admin.from("payment_methods").insert(payload);

  if (insertError) {
    return { inserted: 0, skipped: false, error: insertError.message };
  }

  return { inserted: payload.length, skipped: false, error: null };
}
