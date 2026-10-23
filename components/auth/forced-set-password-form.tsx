"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import PasswordInput from "@/components/password-input";
import { useAlert } from "@/components/feedback";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  SAME_PASSWORD_ALERT_TITLE,
  SAME_PASSWORD_USER_MESSAGE,
  validatePasswordClient,
} from "@/utils/password-policy";
import { clearMustChangePasswordWithNewPassword } from "@/lib/security/clear-must-change-password-action";
import { createClient } from "@/utils/supabase/client";
import { readMustChangeState } from "@/utils/portal-login-access/must-change-state";
import { TEMP_PASSWORD_EXPIRED_MESSAGE } from "@/utils/portal-login-access/types";

export type ForcedSetPasswordFormProps = {
  title?: string;
  brandBgClassName?: string;
  logoAlt?: string;
  /** Sign-in path after logout (portal-specific). */
  loginHref?: string;
};

export default function ForcedSetPasswordForm({
  title = "Set your new password",
  brandBgClassName = "bg-[#0F2744]",
  logoAlt = "DavSuite",
  loginHref = "/login",
}: ForcedSetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [expired, setExpired] = useState(false);
  const [checking, setChecking] = useState(true);
  const { alertError } = useAlert();
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const meta =
        data.user?.app_metadata && typeof data.user.app_metadata === "object"
          ? (data.user.app_metadata as Record<string, unknown>)
          : {};
      const state = readMustChangeState(meta);
      if (state.expired) {
        setExpired(true);
        setError(TEMP_PASSWORD_EXPIRED_MESSAGE);
      }
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase.auth]);

  async function handleLogout() {
    setLoggingOut(true);
    await supabase.auth.signOut();
    window.location.assign(loginHref);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (expired) return;
    setError(null);

    const validationError = validatePasswordClient(password, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    const result = await clearMustChangePasswordWithNewPassword(
      password,
      confirmPassword,
    );
    setLoading(false);

    if (!result.ok) {
      if (result.expired) {
        setExpired(true);
        setError(result.error);
        return;
      }
      if (result.code === "same_password") {
        void alertError(SAME_PASSWORD_USER_MESSAGE, {
          title: SAME_PASSWORD_ALERT_TITLE,
        });
        return;
      }
      void alertError(result.error, { title: "Could not update password" });
      return;
    }

    window.location.assign(result.destination);
  }

  return (
    <div
      className={`flex min-h-screen flex-col items-center justify-center px-4 ${brandBgClassName}`}
    >
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-4 flex justify-center">
          <Image
            src="/icons/icon-512x512.png"
            alt={logoAlt}
            width={64}
            height={64}
            className="h-16 w-16"
          />
        </div>
        <h1 className="mb-2 text-center text-2xl font-semibold text-zinc-900">
          {title}
        </h1>
        {!expired ? (
          <p className="mb-6 text-center text-sm text-zinc-600">
            {PASSWORD_POLICY_HINT}
          </p>
        ) : null}

        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

        {checking ? (
          <p className="text-center text-sm text-zinc-600">Checking…</p>
        ) : expired ? null : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
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
                autoComplete="new-password"
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
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {loading ? "Updating…" : "Save new password"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-zinc-600">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="font-medium text-zinc-800 underline-offset-2 hover:underline disabled:opacity-50"
          >
            {loggingOut ? "Signing out…" : "Log out"}
          </button>
        </p>
      </div>
    </div>
  );
}
