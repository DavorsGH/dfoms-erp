import type { SupabaseClient } from "@supabase/supabase-js";

/** Shared generate_next_code entity for equipment_register.equipment_id. */
export const EQUIPMENT_ID_ENTITY_TYPE = "EQUIPMENT";

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
      error: "Unable to resolve workspace for equipment ID allocation.",
    };
  }

  return { tenantId, error: null };
}

/**
 * Allocates equipment_register.equipment_id via generate_next_code(..., 'EQUIPMENT', 4).
 * Call on create save only — do not use for edits of existing rows.
 */
export async function allocateEquipmentId(
  supabase: SupabaseClient,
): Promise<{ equipmentId: string | null; error: string | null }> {
  const { tenantId, error: tenantError } = await resolveSessionTenantId(supabase);
  if (tenantError || !tenantId) {
    return {
      equipmentId: null,
      error: tenantError ?? "Missing tenant.",
    };
  }

  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: EQUIPMENT_ID_ENTITY_TYPE,
    p_padding: 4,
  });

  if (error) {
    return { equipmentId: null, error: error.message };
  }

  const equipmentId = typeof data === "string" ? data.trim() : "";
  if (!equipmentId) {
    return {
      equipmentId: null,
      error: "generate_next_code returned an empty equipment ID.",
    };
  }

  return { equipmentId, error: null };
}
