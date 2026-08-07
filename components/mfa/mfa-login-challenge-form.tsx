"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSafeNext } from "@/utils/safe-redirect";
import type { MfaPersona } from "@/lib/mfa/types";

type ChallengeActions = {
  getContext: () => Promise<
    | {
        ok: true;
        method: "totp" | "sms";
        maskedPhone?: string;
        email: string;
      }
    | { ok: false; error: string }
  >;
  verifyTotp: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  sendSms: () => Promise<{ ok: true } | { ok: false; error: string }>;
  verifySms: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  cancel: () => Promise<{ ok: true } | { ok: false; error: string }>;
};

type Props = {
  persona: MfaPersona;
  actions: ChallengeActions;
  title: string;
  loginPath: string;
};

export default function MfaLoginChallengeForm({
  persona,
  actions,
  title,
  loginPath,
}: Props) {
  void persona;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [method, setMethod] = useState<"totp" | "sms" | null>(null);
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [smsSent, setSmsSent] = useState(false);

  const destination = getSafeNext(searchParams.get("next"), "/dashboard");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ctx = await actions.getContext();
      if (cancelled) return;
      if (!ctx.ok) {
        setError(ctx.error);
        setLoading(false);
        return;
      }
      setMethod(ctx.method);
      setMaskedPhone(ctx.maskedPhone ?? null);
      setLoading(false);
      if (ctx.method === "sms") {
        const sent = await actions.sendSms();
        if (!cancelled && sent.ok) {
          setSmsSent(true);
        } else if (!cancelled && !sent.ok) {
          setError(sent.error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Load challenge context once on mount; action refs are stable server actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result =
        method === "sms"
          ? await actions.verifySms(code)
          : await actions.verifyTotp(code);

      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }

      // Full navigation so middleware sees fresh auth/MFA cookies and DB session rows.
      window.location.assign(destination);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Verification failed. Please try again.",
      );
      setSubmitting(false);
    }
  }

  async function handleResendSms() {
    setError(null);
    setSubmitting(true);
    const sent = await actions.sendSms();
    if (!sent.ok) {
      setError(sent.error);
    } else {
      setSmsSent(true);
    }
    setSubmitting(false);
  }

  async function handleCancel() {
    setSubmitting(true);
    await actions.cancel();
    router.push(loginPath);
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0F2744] px-4 text-white">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0F2744] px-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-center text-2xl font-semibold text-zinc-900">
          {title}
        </h1>
        <p className="mb-6 text-center text-sm text-zinc-600">
          {method === "sms"
            ? `Enter the code sent to ${maskedPhone ?? "your phone"}.`
            : "Enter the 6-digit code from your authenticator app."}
        </p>

        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label
              htmlFor="mfa-code"
              className="mb-1 block text-sm font-medium text-zinc-700"
            >
              Verification code
            </label>
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-center text-lg tracking-widest text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
              placeholder="000000"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting || code.length !== 6}
            className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Verifying…" : "Verify and continue"}
          </button>
        </form>

        {method === "sms" && (
          <button
            type="button"
            onClick={handleResendSms}
            disabled={submitting}
            className="mt-3 w-full text-sm text-zinc-600 underline hover:text-zinc-900 disabled:opacity-50"
          >
            {smsSent ? "Resend code" : "Send code again"}
          </button>
        )}

        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting}
          className="mt-4 w-full text-sm text-zinc-500 underline hover:text-zinc-800 disabled:opacity-50"
        >
          Cancel and sign out
        </button>
      </div>
    </div>
  );
}
