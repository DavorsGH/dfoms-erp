import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PROJECT_CODE_ENTITY_TYPE,
  PROJECT_CODE_PADDING,
  projectCodeShapeError,
} from "@/lib/project-code";

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
      error: "Unable to resolve workspace for project code allocation.",
    };
  }

  return { tenantId, error: null };
}

/**
 * Allocates projects.project_code via generate_next_code(..., 'PRJ', 2).
 * Call on create save only — edits keep the existing code.
 */
export async function allocateProjectCode(
  supabase: SupabaseClient,
): Promise<{ projectCode: string | null; error: string | null }> {
  const { tenantId, error: tenantError } = await resolveSessionTenantId(supabase);
  if (tenantError || !tenantId) {
    return {
      projectCode: null,
      error: tenantError ?? "Missing tenant.",
    };
  }

  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: PROJECT_CODE_ENTITY_TYPE,
    p_padding: PROJECT_CODE_PADDING,
  });

  if (error) {
    return { projectCode: null, error: error.message };
  }

  const projectCode = typeof data === "string" ? data.trim() : "";
  const shapeError = projectCodeShapeError(projectCode);
  if (shapeError) {
    return { projectCode: null, error: shapeError };
  }

  return { projectCode, error: null };
}
