import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACCOUNT_INACTIVE_NOTICE,
  ACCOUNT_NO_LONGER_ACTIVE_MESSAGE,
  SELF_ROLE_ACCESS_CHANGE_MESSAGE,
  accountInactiveLoginPath,
} from "@/lib/auth/account-inactive-message";

export {
  ACCOUNT_INACTIVE_NOTICE,
  ACCOUNT_NO_LONGER_ACTIVE_MESSAGE,
  SELF_ROLE_ACCESS_CHANGE_MESSAGE,
  accountInactiveLoginPath,
};

/** Long-lived Auth ban — blocks refresh / new sign-in without deleting the Auth user. */
export const AUTH_SESSION_BAN_DURATION = "876000h";

/**
 * Revoke every Auth session for a user (best-effort) and optionally ban them.
 * Matches landlord/lessee deactivate: ban first, then attempt admin.signOut.
 *
 * Note: GoTrue's documented admin.signOut takes a JWT; the SDK call with a
 * user id is best-effort and may no-op. Ban + proxy account gates are the
 * reliable enforcement.
 */
export async function revokeAuthUserSessions(
  admin: SupabaseClient,
  authUserId: string,
  options: { ban?: boolean } = { ban: true },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (options.ban !== false) {
    const { error: banError } = await admin.auth.admin.updateUserById(
      authUserId,
      { ban_duration: AUTH_SESSION_BAN_DURATION },
    );
    if (banError) {
      return { ok: false, error: banError.message };
    }
  }

  const signOut = admin.auth.admin.signOut as
    | ((
        userId: string,
        scope?: "global" | "local" | "others",
      ) => Promise<{ error: Error | null }>)
    | undefined;
  if (typeof signOut === "function") {
    try {
      await signOut.call(admin.auth.admin, authUserId, "global");
    } catch {
      // Best-effort; ban / deleteUser still invalidate ongoing access.
    }
  }

  return { ok: true };
}

export async function clearAuthUserBan(
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
