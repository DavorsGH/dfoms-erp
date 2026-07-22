import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXPENSE_RECEIPT_ENTITY_TYPE,
  normalizeOptionalReceiptNo,
} from "./expense-register-utils";

async function resolveSessionTenantId(
  supabase: SupabaseClient,
): Promise<{ tenantId: string | null; error: string | null }> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return { tenantId: null, error: authError.message };
  }

  if (!user) {
    return { tenantId: null, error: "Not signed in." };
  }

  const { data, error } = await supabase
    .from("user_accounts")
    .select("tenant_id")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (error) {
    return { tenantId: null, error: error.message };
  }

  const tenantId = (data as { tenant_id?: string | null } | null)?.tenant_id ?? null;
  if (!tenantId) {
    return { tenantId: null, error: "Unable to resolve workspace for expense receipt." };
  }

  return { tenantId, error: null };
}

/**
 * Manual expense create: keep a user-supplied vendor receipt number when present;
 * otherwise allocate via generate_next_code(tenant_id, 'EXP', 4).
 * Edit paths should pass through the existing value and skip this helper.
 */
export async function resolveManualExpenseReceiptNo(
  supabase: SupabaseClient,
  suppliedReceiptNo: string | null | undefined,
): Promise<{ receiptNo: string | null; error: string | null }> {
  const explicit = normalizeOptionalReceiptNo(suppliedReceiptNo);
  if (explicit) {
    return { receiptNo: explicit, error: null };
  }

  const { tenantId, error: tenantError } = await resolveSessionTenantId(supabase);
  if (tenantError || !tenantId) {
    return { receiptNo: null, error: tenantError ?? "Missing tenant." };
  }

  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: EXPENSE_RECEIPT_ENTITY_TYPE,
    p_padding: 4,
  });

  if (error) {
    return { receiptNo: null, error: error.message };
  }

  const receiptNo = typeof data === "string" ? data.trim() : "";
  if (!receiptNo) {
    return {
      receiptNo: null,
      error: "generate_next_code returned an empty expense receipt number.",
    };
  }

  return { receiptNo, error: null };
}
