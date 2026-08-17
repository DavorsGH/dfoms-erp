import type { SupabaseClient } from "@supabase/supabase-js";

export type CrossPersonaConflict =
  | { persona: "staff"; detail: string }
  | { persona: "lessee"; detail: string }
  | { persona: "landlord"; detail: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * One email may only belong to one portal persona (staff OR lessee OR landlord).
 * Call before staff invite send/accept and before OAuth accept (later phase).
 */
export async function findCrossPersonaConflictForEmail(
  admin: SupabaseClient,
  email: string,
  options?: {
    /** When accepting a staff invite, allow an existing staff row only if same auth user (unused here). */
    allowStaff?: boolean;
  },
): Promise<CrossPersonaConflict | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }

  if (!options?.allowStaff) {
    const { data: staffRow } = await admin
      .from("user_accounts")
      .select("auth_uid, email, tenant_id")
      .ilike("email", normalized)
      .maybeSingle();

    if (staffRow) {
      return {
        persona: "staff",
        detail:
          "This email is already linked to a staff ERP account. Ask them to sign in or use a different email.",
      };
    }
  }

  const { data: lesseeRow } = await admin
    .from("lessees")
    .select("lessee_id, auth_user_id, email")
    .ilike("email", normalized)
    .not("auth_user_id", "is", null)
    .maybeSingle();

  if (lesseeRow?.auth_user_id) {
    return {
      persona: "lessee",
      detail:
        "This email is already linked to a Tenant Portal account. Staff invites cannot use the same email.",
    };
  }

  const { data: landlordTenant } = await admin
    .from("tenants")
    .select("id")
    .ilike("email", normalized)
    .eq("product_line", "real_estate_only")
    .maybeSingle();

  if (landlordTenant) {
    const { data: landlordMatch } = await admin
      .from("landlords")
      .select("auth_user_id")
      .eq("tenant_id", landlordTenant.id)
      .not("auth_user_id", "is", null)
      .maybeSingle();

    if (landlordMatch?.auth_user_id) {
      return {
        persona: "landlord",
        detail:
          "This email is already linked to a Landlord Portal account. Staff invites cannot use the same email.",
      };
    }
  }

  return null;
}

/**
 * Resolve auth user by email and reject if linked to a non-staff persona.
 */
export async function findCrossPersonaConflictForAuthUid(
  admin: SupabaseClient,
  authUid: string,
): Promise<CrossPersonaConflict | null> {
  const { data: staffRow } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", authUid)
    .maybeSingle();

  if (staffRow) {
    return {
      persona: "staff",
      detail:
        "This sign-in is already linked to a staff ERP account, not this portal.",
    };
  }

  const { data: lessee } = await admin
    .from("lessees")
    .select("lessee_id")
    .eq("auth_user_id", authUid)
    .maybeSingle();

  if (lessee) {
    return {
      persona: "lessee",
      detail:
        "This sign-in is linked to a Tenant Portal account, not staff ERP.",
    };
  }

  const { data: landlord } = await admin
    .from("landlords")
    .select("tenant_id")
    .eq("auth_user_id", authUid)
    .maybeSingle();

  if (landlord) {
    return {
      persona: "landlord",
      detail:
        "This sign-in is linked to a Landlord Portal account, not staff ERP.",
    };
  }

  return null;
}

export function crossPersonaErrorMessage(conflict: CrossPersonaConflict): string {
  return conflict.detail;
}
