import type { SupabaseClient } from "@supabase/supabase-js";

/** finished_products.product_code */
export const FINISHED_PRODUCT_ENTITY_TYPE = "FP";
/** raw_materials.material_code */
export const RAW_MATERIAL_ENTITY_TYPE = "RM";
/** production_batches.batch_number */
export const PRODUCTION_BATCH_ENTITY_TYPE = "BATCH";

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

  const tenantId =
    (data as { tenant_id?: string | null } | null)?.tenant_id ?? null;
  if (!tenantId) {
    return {
      tenantId: null,
      error: "Unable to resolve workspace for inventory ID allocation.",
    };
  }

  return { tenantId, error: null };
}

async function allocateInventoryCode(
  supabase: SupabaseClient,
  entityType: string,
  emptyError: string,
): Promise<{ code: string | null; error: string | null }> {
  const { tenantId, error: tenantError } = await resolveSessionTenantId(supabase);
  if (tenantError || !tenantId) {
    return { code: null, error: tenantError ?? "Missing tenant." };
  }

  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: entityType,
    p_padding: 4,
  });

  if (error) {
    return { code: null, error: error.message };
  }

  const code = typeof data === "string" ? data.trim() : "";
  if (!code) {
    return { code: null, error: emptyError };
  }

  return { code, error: null };
}

/** finished_products.product_code — generate_next_code(..., 'FP', 4). Create-save only. */
export async function allocateProductCode(
  supabase: SupabaseClient,
): Promise<{ productCode: string | null; error: string | null }> {
  const result = await allocateInventoryCode(
    supabase,
    FINISHED_PRODUCT_ENTITY_TYPE,
    "generate_next_code returned an empty product code.",
  );
  return { productCode: result.code, error: result.error };
}

/** raw_materials.material_code — generate_next_code(..., 'RM', 4). Create-save only. */
export async function allocateMaterialCode(
  supabase: SupabaseClient,
): Promise<{ materialCode: string | null; error: string | null }> {
  const result = await allocateInventoryCode(
    supabase,
    RAW_MATERIAL_ENTITY_TYPE,
    "generate_next_code returned an empty material code.",
  );
  return { materialCode: result.code, error: result.error };
}

/** production_batches.batch_number — generate_next_code(..., 'BATCH', 4). Create-save only. */
export async function allocateBatchNumber(
  supabase: SupabaseClient,
): Promise<{ batchNumber: string | null; error: string | null }> {
  const result = await allocateInventoryCode(
    supabase,
    PRODUCTION_BATCH_ENTITY_TYPE,
    "generate_next_code returned an empty batch number.",
  );
  return { batchNumber: result.code, error: result.error };
}
