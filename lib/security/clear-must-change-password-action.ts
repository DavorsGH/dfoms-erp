"use server";

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  isSamePasswordAuthError,
  mapSupabasePasswordError,
  validatePasswordClient,
} from "@/utils/password-policy";
import { recordPasswordUpdatedAt } from "./password-updated-at";
import { clearMustChangeAppMetadata } from "@/utils/portal-login-access/temp-password";
import { readMustChangeState } from "@/utils/portal-login-access/must-change-state";
import { TEMP_PASSWORD_EXPIRED_MESSAGE } from "@/utils/portal-login-access/types";

export type ClearMustChangePasswordResult =
  | { ok: true; destination: string }
  | {
      ok: false;
      error: string;
      expired?: boolean;
      code?: "same_password";
    };

function destinationForPortal(
  portal: string | undefined,
): string {
  if (portal === "landlord") return "/landlord-portal/dashboard";
  if (portal === "facility_manager") return "/facility-portal/dashboard";
  if (portal === "lessee") return "/portal/dashboard";
  if (portal === "staff") return "/dashboard";
  return "/dashboard";
}

/**
 * Signed-in user chooses a new password after admin/landlord set a temporary one.
 * Clears must_change_password + temp_password_expires_at via service role.
 * Both password update and flag clear must succeed — no silent partial success.
 */
export async function clearMustChangePasswordWithNewPassword(
  password: string,
  confirmPassword: string,
): Promise<ClearMustChangePasswordResult> {
  const validationError = validatePasswordClient(password, confirmPassword);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const admin = createAdminClient();
  const { data: authData, error: loadError } =
    await admin.auth.admin.getUserById(user.id);
  if (loadError || !authData?.user) {
    return { ok: false, error: "Could not load your account." };
  }

  const appMetadata =
    authData.user.app_metadata &&
    typeof authData.user.app_metadata === "object"
      ? (authData.user.app_metadata as Record<string, unknown>)
      : {};
  const state = readMustChangeState(appMetadata);
  const portal =
    typeof authData.user.user_metadata?.portal === "string"
      ? authData.user.user_metadata.portal
      : undefined;
  const destination = destinationForPortal(portal);

  if (!state.mustChange) {
    return { ok: true, destination };
  }

  if (state.expired) {
    return {
      ok: false,
      error: TEMP_PASSWORD_EXPIRED_MESSAGE,
      expired: true,
    };
  }

  const { error: passwordError } = await supabase.auth.updateUser({
    password,
  });
  if (passwordError) {
    return {
      ok: false,
      error: mapSupabasePasswordError(passwordError),
      code: isSamePasswordAuthError(passwordError) ? "same_password" : undefined,
    };
  }

  const clearedMetadata = clearMustChangeAppMetadata(appMetadata);
  const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: clearedMetadata,
  });
  if (metaError) {
    return {
      ok: false,
      error:
        "Your password was updated, but we could not clear the temporary-password requirement. Contact support before signing in again.",
    };
  }

  const { data: verifyData, error: verifyError } =
    await admin.auth.admin.getUserById(user.id);
  if (verifyError || !verifyData?.user) {
    return {
      ok: false,
      error:
        "Your password was updated, but we could not confirm the temporary-password flag was cleared. Contact support.",
    };
  }

  const verifiedMeta =
    verifyData.user.app_metadata &&
    typeof verifyData.user.app_metadata === "object"
      ? (verifyData.user.app_metadata as Record<string, unknown>)
      : {};
  const verifiedState = readMustChangeState(verifiedMeta);
  if (verifiedState.mustChange) {
    return {
      ok: false,
      error:
        "Your password was updated, but the temporary-password requirement is still active. Contact support.",
    };
  }

  await recordPasswordUpdatedAt(user.id);

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    return {
      ok: false,
      error:
        "Your password was updated, but we could not refresh your session. Sign out, then sign in with your new password.",
    };
  }

  return { ok: true, destination };
}
