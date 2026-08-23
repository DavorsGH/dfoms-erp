"use client";

import Image from "next/image";
import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import PasswordInput from "@/components/password-input";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  mapSupabasePasswordError,
  validatePasswordClient,
} from "@/utils/password-policy";
import { resolvePasswordResetRedirect } from "@/lib/auth/reset-password-redirect-action";
import { recordOwnPasswordChanged } from "@/lib/security/update-password-action";
import { establishRecoverySessionFromUrl } from "@/utils/auth/establish-recovery-session";
import { PORTAL_CHOOSER_PATH } from "@/utils/portal-chooser";

export type ResetPasswordFormProps = {
  title?: string;
  brandBgClassName?: string;
};

/**
 * Recovery email → establish session (code / token_hash / hash) → updateUser({ password }).
 * Shared by staff /reset-password, landlord-portal, and portal pages.
 */
function ResetPasswordFormInner({
  title = "Set a new password",
  brandBgClassName = "bg-[#0F2744]",
}: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState(
    "Password updated. Redirecting to sign in…",
  );
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;

    void establishRecoverySessionFromUrl(supabase).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validatePasswordClient(password, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(mapSupabasePasswordError(updateError));
      return;
    }

    await recordOwnPasswordChanged();

    const redirectResult = await resolvePasswordResetRedirect();
    const loginPath = redirectResult.ok
      ? redirectResult.destination.loginPath
      : PORTAL_CHOOSER_PATH;
    const message = redirectResult.ok
      ? redirectResult.destination.successMessage
      : "Password updated — choose your portal to sign in.";

    await supabase.auth.signOut();

    setSuccessMessage(message);
    setSuccess(true);
    setTimeout(() => router.push(loginPath), 2000);
  }

  return (
    <div
      className={`flex min-h-screen flex-col items-center justify-center px-4 ${brandBgClassName}`}
    >
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-4 flex justify-center">
          <Image
            src="/icons/apple-touch-icon-180x180.png"
            alt="Davors Facilities"
            width={64}
            height={64}
            className="h-16 w-16"
          />
        </div>
        <h1 className="mb-2 text-center text-2xl font-semibold text-zinc-900">
          {title}
        </h1>
        <p className="mb-6 text-center text-sm text-zinc-600">
          {PASSWORD_POLICY_HINT}
        </p>

        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

        {success ? (
          <p className="text-center text-sm text-emerald-700">{successMessage}</p>
        ) : ready ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                New password
              </label>
              <PasswordInput
                required
                minLength={PASSWORD_MIN_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                Confirm password
              </label>
              <PasswordInput
                required
                minLength={PASSWORD_MIN_LENGTH}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        ) : (
          !error && (
            <p className="text-center text-sm text-zinc-600">Verifying link…</p>
          )
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordForm(props: ResetPasswordFormProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0F2744] text-sm text-white">
          Loading…
        </div>
      }
    >
      <ResetPasswordFormInner {...props} />
    </Suspense>
  );
}

