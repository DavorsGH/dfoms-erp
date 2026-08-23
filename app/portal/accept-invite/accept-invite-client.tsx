"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PasswordInput from "@/components/password-input";
import OAuthProviderButtons from "@/components/auth/oauth-provider-buttons";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  validatePasswordClient,
} from "@/utils/password-policy";
import {
  portalAuthCardClassName,
  portalAuthInputClassName,
  portalAuthPrimaryButtonClassName,
  portalLabelClassName,
} from "../portal-ui";

export default function AcceptInvitePage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState(
    "Account created. Redirecting to login…",
  );
  const [token, setToken] = useState<string | null>(null);
  const [existingAccount, setExistingAccount] = useState(false);
  const [reuseHint, setReuseHint] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const inviteToken = searchParams.get("token")?.trim() ?? "";
    if (!inviteToken) {
      setError("This invite link is invalid or missing required parameters.");
      return;
    }
    setToken(inviteToken);

    let cancelled = false;
    (async () => {
      const response = await fetch(
        `/api/portal/accept-invite?token=${encodeURIComponent(inviteToken)}`,
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        existingAccount?: boolean;
        message?: string | null;
      } | null;
      if (cancelled) return;
      if (!response.ok) {
        setError(payload?.error ?? "This invite link is invalid.");
        return;
      }
      setExistingAccount(Boolean(payload?.existingAccount));
      setReuseHint(payload?.message ?? null);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("Missing invite token.");
      return;
    }
    if (!existingAccount) {
      const validationError = validatePasswordClient(password, confirmPassword);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setLoading(true);
    const response = await fetch("/api/portal/accept-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        password: existingAccount ? "" : password,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      reusedExistingAccount?: boolean;
      message?: string | null;
    } | null;
    setLoading(false);

    if (!response.ok) {
      setError(payload?.error ?? "Unable to accept invite.");
      return;
    }

    setSuccessMessage(
      payload?.reusedExistingAccount && payload.message
        ? `${payload.message} Redirecting to login…`
        : "Account created. Redirecting to login…",
    );
    setSuccess(true);
    setTimeout(() => {
      router.push("/portal/login");
    }, 2500);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0F2744] px-4">
      <div className={portalAuthCardClassName}>
        <div className="mb-4 flex justify-center">
          <Image
            src="/icons/apple-touch-icon-180x180.png"
            alt="Davors Facilities"
            width={80}
            height={80}
            className="h-20 w-20"
            priority
          />
        </div>
        <h1 className="mb-2 text-center text-2xl font-semibold text-[#0f2744]">
          Accept Tenant Invite
        </h1>
        <p className="mb-6 text-center text-sm text-slate-600">
          {existingAccount
            ? "Link this lease to your existing portal account."
            : "Set a password to access your Davors Tenant Portal."}
        </p>

        {success ? (
          <p className="text-center text-sm text-slate-700">{successMessage}</p>
        ) : error && !ready ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <Link
              href="/portal/login"
              className="inline-block text-sm font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
            >
              Go to Tenant Portal login
            </Link>
          </div>
        ) : !ready ? (
          <p className="text-center text-sm text-slate-600">
            Checking invite link…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {existingAccount ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {reuseHint ??
                  "You already have an account. Continue to link this lease, then sign in with your existing password."}
              </p>
            ) : (
              <>
                <div>
                  <label htmlFor="password" className={portalLabelClassName}>
                    Password
                  </label>
                  <PasswordInput
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={portalAuthInputClassName}
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className={portalLabelClassName}>
                    Confirm Password
                  </label>
                  <PasswordInput
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className={portalAuthInputClassName}
                    placeholder="••••••••"
                  />
                </div>
                <p className="text-xs text-slate-500">{PASSWORD_POLICY_HINT}</p>
              </>
            )}
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <button
              type="submit"
              disabled={loading}
              className={portalAuthPrimaryButtonClassName}
            >
              {loading
                ? "Working…"
                : existingAccount
                  ? "Link portal account"
                  : "Create account"}
            </button>

            <OAuthProviderButtons
              persona="lessee"
              flow="accept_invite"
              inviteToken={token}
            />
          </form>
        )}
      </div>
    </div>
  );
}
