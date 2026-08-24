import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

function normalizeLesseeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * True when another non-former lessee row (any landlord) already uses this email
 * (case-insensitive). Former records are ignored (same rule as
 * findCrossPersonaConflictForEmail). Does not return or expose the other record.
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
    .neq("status", "former")
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
