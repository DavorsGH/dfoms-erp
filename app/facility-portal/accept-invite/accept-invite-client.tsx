"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PasswordInput from "@/components/password-input";
import OAuthProviderButtons from "@/components/auth/oauth-provider-buttons";
import {
  PASSWORD_POLICY_HINT,
  validatePasswordClient,
} from "@/utils/password-policy";
import {
  portalAuthCardClassName,
  portalAuthInputClassName,
  portalAuthPrimaryButtonClassName,
  portalLabelClassName,
} from "../portal-ui";

export default function FacilityAcceptInvitePage() {
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
  const [email, setEmail] = useState<string | null>(null);
  const [landlordName, setLandlordName] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
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
        `/api/facility-portal/accept-invite?token=${encodeURIComponent(inviteToken)}`,
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        existingAccount?: boolean;
        message?: string | null;
        email?: string;
        landlord_name?: string;
        expires_at?: string;
      } | null;
      if (cancelled) return;
      if (!response.ok) {
        setError(payload?.error ?? "This invite link is invalid.");
        return;
      }
      setExistingAccount(Boolean(payload?.existingAccount));
      setReuseHint(payload?.message ?? null);
      setEmail(payload?.email ?? null);
      setLandlordName(payload?.landlord_name ?? null);
      setExpiresAt(payload?.expires_at ?? null);
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
    const response = await fetch("/api/facility-portal/accept-invite", {
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
      router.push("/facility-portal/login");
    }, 2500);
  }

  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

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
          Accept Facility Manager Invite
        </h1>
        <p className="mb-4 text-center text-sm text-slate-600">
          {landlordName
            ? `${landlordName} invited you to the Facility Manager Portal.`
            : "Set a password to access the Facility Manager Portal."}
        </p>
        {email || expiryLabel ? (
          <div className="mb-6 space-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {email ? (
              <p>
                <span className="font-medium">Email:</span> {email}
              </p>
            ) : null}
            {expiryLabel ? (
              <p>
                <span className="font-medium">Expires:</span> {expiryLabel}
              </p>
            ) : null}
          </div>
        ) : null}

        {success ? (
          <p className="text-center text-sm text-slate-700">{successMessage}</p>
        ) : error && !ready ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <Link
              href="/facility-portal/login"
              className="inline-block text-sm font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
            >
              Go to Facility Manager login
            </Link>
          </div>
        ) : !ready ? (
          <p className="text-center text-sm text-slate-600">
            Checking invite link…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {existingAccount ? (
              <p className="text-sm text-slate-600">
                {reuseHint ??
                  "You already have an account. Accept to link Facility Manager access, then sign in with your existing password."}
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
                  <label
                    htmlFor="confirmPassword"
                    className={portalLabelClassName}
                  >
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
                ? existingAccount
                  ? "Linking account…"
                  : "Creating account…"
                : existingAccount
                  ? "Accept invite"
                  : "Create account"}
            </button>
            {token ? (
              <OAuthProviderButtons
                persona="facility_manager"
                flow="accept_invite"
                inviteToken={token}
              />
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
