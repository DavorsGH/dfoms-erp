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

export default function StaffAcceptInviteClient() {
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
        `/api/staff/accept-invite?token=${encodeURIComponent(inviteToken)}`,
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
    const response = await fetch("/api/staff/accept-invite", {
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
      router.push("/login");
    }, 2500);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0F2744] px-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
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
        <h1 className="mb-2 text-center text-2xl font-semibold text-zinc-900">
          Accept Staff Invite
        </h1>
        <p className="mb-6 text-center text-sm text-zinc-600">
          {existingAccount
            ? "Join this workspace with your existing account."
            : "Set a password to access Davors Facilities ERP."}
        </p>

        {success ? (
          <p className="text-center text-sm text-zinc-700">{successMessage}</p>
        ) : error && !ready ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <Link
              href="/login"
              className="inline-block text-sm font-medium text-zinc-900 underline hover:text-zinc-700"
            >
              Go to staff login
            </Link>
          </div>
        ) : !ready ? (
          <p className="text-center text-sm text-zinc-600">Checking invite link…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {existingAccount ? (
              <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                {reuseHint ??
                  "You already have an account. Continue to join this workspace, then sign in with your existing password."}
              </p>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="password"
                    className="mb-1 block text-sm font-medium text-zinc-700"
                  >
                    Password
                  </label>
                  <PasswordInput
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="mb-1 block text-sm font-medium text-zinc-700"
                  >
                    Confirm Password
                  </label>
                  <PasswordInput
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                    placeholder="••••••••"
                  />
                </div>
                <p className="text-xs text-zinc-500">{PASSWORD_POLICY_HINT}</p>
              </>
            )}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? "Working…"
                : existingAccount
                  ? "Join workspace"
                  : "Create account"}
            </button>

            <OAuthProviderButtons
              persona="staff"
              flow="accept_invite"
              inviteToken={token}
            />
          </form>
        )}
      </div>
    </div>
  );
}
