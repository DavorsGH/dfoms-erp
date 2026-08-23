"use server";

import { cookies } from "next/headers";
import { findAnyPersonaByAuthUid } from "@/lib/auth/oauth-persona-resolve";
import {
  passwordResetDestinationForPersona,
  type PasswordResetDestination,
} from "@/lib/auth/reset-password-redirect";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export type ResolvePasswordResetRedirectResult =
  | { ok: true; destination: PasswordResetDestination }
  | { ok: false; error: string };

/**
 * Resolve where to send the user after a successful recovery password update.
 * Requires an active recovery session (same as recordOwnPasswordChanged).
 */
export async function resolvePasswordResetRedirect(): Promise<ResolvePasswordResetRedirectResult> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error:
        "Your session expired. Sign in with your new password from the correct portal.",
    };
  }

  const admin = createAdminClient();
  const persona = await findAnyPersonaByAuthUid(admin, user.id);
  const destination = passwordResetDestinationForPersona(persona);

  return { ok: true, destination };
}
