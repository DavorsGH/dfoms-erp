import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve the signed-in user's employee_id from user_accounts (browser Supabase client).
 * Same source as server-side getCurrentUserEmployeeId().
 */
export async function resolveSessionEmployeeId(
  supabase: SupabaseClient,
): Promise<{ employeeId: string | null; error: string | null }> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return { employeeId: null, error: authError.message };
  }

  if (!user) {
    return { employeeId: null, error: "Not signed in." };
  }

  const { data, error } = await supabase
    .from("user_accounts")
    .select("employee_id")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (error) {
    return { employeeId: null, error: error.message };
  }

  const employeeId =
    (data as { employee_id?: string | null } | null)?.employee_id ?? null;

  return { employeeId, error: null };
}
