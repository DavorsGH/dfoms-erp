import type { SupabaseClient } from "@supabase/supabase-js";

type AdminDeleteSubcategoryResult =
  | { ok: true }
  | { ok: false; error: string };

export async function adminDeleteExpenseSubcategory(
  supabase: SupabaseClient,
  subcategoryId: string,
): Promise<AdminDeleteSubcategoryResult> {
  const { data, error } = await supabase.rpc("admin_delete_expense_subcategory", {
    p_subcategory_id: subcategoryId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = (data ?? {}) as { ok?: boolean; error?: string };
  if (payload.ok === true) {
    return { ok: true };
  }

  return {
    ok: false,
    error: payload.error ?? "Could not delete sub-category.",
  };
}
