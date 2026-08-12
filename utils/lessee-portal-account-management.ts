import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mapSupabasePasswordError,
  validatePasswordLength,
} from "@/utils/password-policy";
import { recordPasswordUpdatedAt } from "@/lib/security/password-updated-at";

/** Long-lived Auth ban — blocks new sign-in / refresh without deleting the Auth user. */
const PORTAL_BAN_DURATION = "876000h";

export type LesseePortalAccountLookup = {
  lesseeId: string;
  fullName: string;
  email: string | null;
  authUserId: string;
};

/**
 * Resolve a lessee in the landlord's tenant that already has a portal Auth user.
 * Does not clear auth_user_id or delete history — deactivate uses Auth ban instead.
 *
 * SCHEMA FLAG: no public.lessees column for portal disable. Staff user_accounts.is_active
 * has no lessee equivalent; portal access is toggled via auth.users ban (banned_until).
 */
export async function lookupLesseePortalAccount(
  admin: SupabaseClient,
  args: { tenantId: string; lesseeId: string },
): Promise<
  | { ok: true; account: LesseePortalAccountLookup }
  | { ok: false; error: string; status: 400 | 404 }
> {
  const { data: lessee, error } = await admin
    .from("lessees")
    .select("lessee_id, full_name, email, auth_user_id")
    .eq("tenant_id", args.tenantId)
    .eq("lessee_id", args.lesseeId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }
  if (!lessee) {
    return { ok: false, error: "Lessee not found.", status: 404 };
  }

  const authUserId =
    typeof lessee.auth_user_id === "string" ? lessee.auth_user_id.trim() : "";
  if (!authUserId) {
    return {
      ok: false,
      error: "This lessee does not have a portal account yet.",
      status: 400,
    };
  }

  return {
    ok: true,
    account: {
      lesseeId: lessee.lessee_id,
      fullName:
        typeof lessee.full_name === "string" ? lessee.full_name : "Lessee",
      email:
        typeof lessee.email === "string" ? lessee.email.trim() || null : null,
      authUserId,
    },
  };
}

export function isAuthUserBanned(
  bannedUntil: string | null | undefined,
  now = new Date(),
): boolean {
  if (!bannedUntil) return false;
  const until = new Date(bannedUntil);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() > now.getTime();
}

export async function deactivateLesseePortalAccess(
  admin: SupabaseClient,
  authUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: banError } = await admin.auth.admin.updateUserById(
    authUserId,
    { ban_duration: PORTAL_BAN_DURATION },
  );
  if (banError) {
    return { ok: false, error: banError.message };
  }

  // Best-effort: revoke refresh tokens so re-login is required after ban.
  const signOut = admin.auth.admin.signOut as
    | ((userId: string, scope?: "global" | "local" | "others") => Promise<{
        error: Error | null;
      }>)
    | undefined;
  if (typeof signOut === "function") {
    await signOut.call(admin.auth.admin, authUserId, "global");
  }

  return { ok: true };
}

export async function reactivateLesseePortalAccess(
  admin: SupabaseClient,
  authUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.auth.admin.updateUserById(authUserId, {
    ban_duration: "none",
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function resetLesseePortalPassword(
  admin: SupabaseClient,
  authUserId: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const lengthError = validatePasswordLength(password);
  if (lengthError) {
    return { ok: false, error: lengthError };
  }

  const { error } = await admin.auth.admin.updateUserById(authUserId, {
    password,
  });
  if (error) {
    return { ok: false, error: mapSupabasePasswordError(error) };
  }

  await recordPasswordUpdatedAt(authUserId);
  return { ok: true };
}
