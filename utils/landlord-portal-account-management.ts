import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthUserBanned } from "@/utils/lessee-portal-account-management";

/** Long-lived Auth ban — blocks new sign-in / refresh without deleting the Auth user. */
const PORTAL_BAN_DURATION = "876000h";

export { isAuthUserBanned };

export async function suspendLandlordPortalAccess(
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

export async function reactivateLandlordPortalAccess(
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
