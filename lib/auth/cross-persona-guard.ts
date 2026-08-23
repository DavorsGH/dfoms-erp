import type { SupabaseClient } from "@supabase/supabase-js";

/** Shown when an email/auth uid still has an active staff membership elsewhere. */
export const ACTIVE_STAFF_OTHER_BUSINESS_MESSAGE =
  "This email is in use by an active account at another business.";

export type CrossPersonaTarget = "staff" | "lessee" | "landlord";

export type CrossPersonaConflict =
  | { persona: "staff"; detail: string }
  | { persona: "lessee"; detail: string }
  | { persona: "landlord"; detail: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function emailConflictMessage(
  conflictPersona: CrossPersonaConflict["persona"],
  target: CrossPersonaTarget,
): string {
  if (conflictPersona === "staff" && target === "staff") {
    return ACTIVE_STAFF_OTHER_BUSINESS_MESSAGE;
  }

  if (target === "landlord") {
    switch (conflictPersona) {
      case "staff":
        return "This email is already linked to a staff ERP account. Sign in there or use a different email.";
      case "lessee":
        return "This email is already linked to a Tenant Portal account. Use a different email or ask the tenant to sign in to their portal.";
      case "landlord":
        return "A landlord account with this email already exists. Try signing in instead.";
    }
  }

  if (target === "lessee") {
    switch (conflictPersona) {
      case "staff":
        return "This email is already linked to an active staff ERP account, not the Tenant Portal.";
      case "lessee":
        return "This email is already linked to an active Tenant Portal account. Try signing in instead.";
      case "landlord":
        return "This email is already linked to a Landlord Portal account. Use a different email.";
    }
  }

  switch (conflictPersona) {
    case "staff":
      return "This email is already linked to an active staff ERP account. Ask them to sign in or use a different email.";
    case "lessee":
      return "This email is already linked to an active Tenant Portal account. Staff invites cannot use the same email.";
    case "landlord":
      return "This email is already linked to a Landlord Portal account. Staff invites cannot use the same email.";
  }
}

function authUidConflictMessage(
  conflictPersona: CrossPersonaConflict["persona"],
  target: CrossPersonaTarget,
): string {
  if (conflictPersona === "staff" && target === "staff") {
    return ACTIVE_STAFF_OTHER_BUSINESS_MESSAGE;
  }

  if (target === "landlord") {
    switch (conflictPersona) {
      case "staff":
        return "This sign-in is already linked to a staff ERP account, not the Landlord Portal.";
      case "lessee":
        return "This sign-in is already linked to a Tenant Portal account, not the Landlord Portal.";
      case "landlord":
        return "A landlord account with this sign-in already exists. Try signing in instead.";
    }
  }

  if (target === "lessee") {
    switch (conflictPersona) {
      case "staff":
        return "This sign-in is already linked to an active staff ERP account, not this portal.";
      case "lessee":
        return "This sign-in is already linked to an active Tenant Portal account. Try signing in instead.";
      case "landlord":
        return "This sign-in is linked to a Landlord Portal account, not this portal.";
    }
  }

  switch (conflictPersona) {
    case "staff":
      return "This sign-in is already linked to an active staff ERP account, not this portal.";
    case "lessee":
      return "This sign-in is linked to an active Tenant Portal account, not staff ERP.";
    case "landlord":
      return "This sign-in is linked to a Landlord Portal account, not staff ERP.";
  }
}

/**
 * One email may only belong to one ACTIVE portal persona (staff OR lessee OR landlord).
 * Inactive staff (is_active=false) and former/unlinked lessees do not block sequential reuse.
 * Call before staff invite send/accept, OAuth accept, and portal self-signup.
 */
export async function findCrossPersonaConflictForEmail(
  admin: SupabaseClient,
  email: string,
  options?: {
    /** Portal context for user-facing error copy. Defaults to staff (invite) wording. */
    targetPersona?: CrossPersonaTarget;
    /** When accepting a staff invite, allow an existing staff row only if same auth user (unused here). */
    allowStaff?: boolean;
    /** Skip lessee-row conflict when updating this lessee's own contact email. */
    excludeLesseeId?: string;
  },
): Promise<CrossPersonaConflict | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }

  const target = options?.targetPersona ?? "staff";

  if (!options?.allowStaff) {
    const { data: staffRow } = await admin
      .from("user_accounts")
      .select("auth_uid, email, tenant_id, is_active")
      .ilike("email", normalized)
      .eq("is_active", true)
      .maybeSingle();

    if (staffRow) {
      return {
        persona: "staff",
        detail: emailConflictMessage("staff", target),
      };
    }
  }

  const { data: lesseeRow } = await admin
    .from("lessees")
    .select("lessee_id, auth_user_id, email, status")
    .ilike("email", normalized)
    .not("auth_user_id", "is", null)
    .neq("status", "former")
    .maybeSingle();

  if (
    lesseeRow?.auth_user_id &&
    lesseeRow.lessee_id !== options?.excludeLesseeId
  ) {
    return {
      persona: "lessee",
      detail: emailConflictMessage("lessee", target),
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
        detail: emailConflictMessage("landlord", target),
      };
    }
  }

  return null;
}

/**
 * Reject when auth.uid() is already linked to a different ACTIVE portal persona.
 */
export async function findCrossPersonaConflictForAuthUid(
  admin: SupabaseClient,
  authUid: string,
  options?: {
    targetPersona?: CrossPersonaTarget;
  },
): Promise<CrossPersonaConflict | null> {
  const target = options?.targetPersona ?? "staff";

  const { data: staffRow } = await admin
    .from("user_accounts")
    .select("auth_uid, is_active")
    .eq("auth_uid", authUid)
    .eq("is_active", true)
    .maybeSingle();

  if (staffRow) {
    return {
      persona: "staff",
      detail: authUidConflictMessage("staff", target),
    };
  }

  const { data: lessee } = await admin
    .from("lessees")
    .select("lessee_id")
    .eq("auth_user_id", authUid)
    .neq("status", "former")
    .maybeSingle();

  if (lessee) {
    return {
      persona: "lessee",
      detail: authUidConflictMessage("lessee", target),
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
      detail: authUidConflictMessage("landlord", target),
    };
  }

  return null;
}

export function crossPersonaErrorMessage(conflict: CrossPersonaConflict): string {
  return conflict.detail;
}
