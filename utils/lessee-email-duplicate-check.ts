import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

function normalizeLesseeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * True when another lessee row (any landlord) already uses this email (case-insensitive).
 * Does not return or expose the other record — boolean only.
 */
export async function hasDuplicateLesseeEmailOnAnotherRecord(
  admin: SupabaseClient,
  email: string,
  excludeLesseeId?: string | null,
): Promise<boolean> {
  const normalized = normalizeLesseeEmail(email);
  if (!normalized) {
    return false;
  }

  const { data, error } = await admin
    .from("lessees")
    .select("lessee_id")
    .ilike("email", normalized)
    .limit(5);

  if (error) {
    throw new Error(error.message);
  }

  const trimmedExclude = excludeLesseeId?.trim() ?? "";
  const rows = (data ?? []).filter(
    (row) =>
      typeof row.lessee_id === "string" &&
      (!trimmedExclude || row.lessee_id !== trimmedExclude),
  );

  return rows.length > 0;
}
