import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolvePublicSiteUrl } from "@/utils/public-site-url";
import type { PortalLoginTargetPersona } from "./types";

function publishableKey(): string | null {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    null
  );
}

function resetCompletionPath(persona: PortalLoginTargetPersona): string {
  if (persona === "landlord") return "/landlord-portal/reset-password";
  if (persona === "facility_manager") return "/facility-portal/reset-password";
  if (persona === "staff") return "/reset-password";
  return "/portal/reset-password";
}

/**
 * Send the standard Supabase recovery email (Auth SMTP / Resend template).
 * Prefer resetPasswordForEmail; fall back to generateLink + Resend only if needed.
 */
export async function sendPortalRecoveryEmail(options: {
  email: string;
  persona: PortalLoginTargetPersona;
}): Promise<
  | { ok: true; method: "resetPasswordForEmail" | "generateLink" }
  | { ok: false; error: string }
> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = publishableKey();
  const redirectTo = `${resolvePublicSiteUrl().replace(/\/$/, "")}${resetCompletionPath(options.persona)}`;
  const email = options.email.trim().toLowerCase();

  if (supabaseUrl && key) {
    const anon = createClient(supabaseUrl, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await anon.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (!error) {
      return { ok: true, method: "resetPasswordForEmail" };
    }
    console.error(
      "[portal-login-access] resetPasswordForEmail failed, trying generateLink:",
      error.message,
    );
  }

  const admin = createAdminClient();
  const { data, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  if (linkError || !data?.properties?.hashed_token) {
    return {
      ok: false,
      error:
        linkError?.message ??
        "Could not send password reset link. Please try again.",
    };
  }

  const { sendResendEmail, RESEND_PLATFORM_FROM } = await import(
    "@/utils/resend-email"
  );
  const verifyUrl = `${resolvePublicSiteUrl().replace(/\/$/, "")}${resetCompletionPath(options.persona)}?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
  const result = await sendResendEmail({
    to: email,
    subject: "Reset your DavSuite password",
    html: `<p>Use the link below to reset your password:</p><p><a href="${verifyUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    text: `Reset your password: ${verifyUrl}\n\nIf you did not request this, you can ignore this email.`,
    from: RESEND_PLATFORM_FROM,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, method: "generateLink" };
}
