"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

export type ForgotPasswordFormProps = {
  /** Path the recovery email should land on (e.g. /landlord-portal/reset-password). */
  resetCompletionPath: string;
  loginPath: string;
  title?: string;
  brandBgClassName?: string;
};

/**
 * Same Supabase Auth resetPasswordForEmail flow as staff /forgot-password.
 * Does not create or mutate persona rows — Auth only.
 */
export default function ForgotPasswordForm({
  resetCompletionPath,
  loginPath,
  title = "Reset Password",
  brandBgClassName = "bg-[#0F2744]",
}: ForgotPasswordFormProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: `${window.location.origin}${resetCompletionPath}`,
      },
    );

    setLoading(false);

    // Always show the neutral confirmation for successful API responses.
    // Supabase does not reveal whether the email exists for valid requests.
    if (resetError) {
      // Rate-limit / config errors still surface; do not invent "email not found".
      setError(resetError.message);
      return;
    }

    setSubmitted(true);
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
            width={80}
            height={80}
            className="h-20 w-20"
            priority
          />
        </div>
        <h1 className="mb-2 text-center text-2xl font-semibold text-zinc-900">
          {title}
        </h1>

        {submitted ? (
          <p className="text-center text-sm text-zinc-700">
            If an account exists for that email, a password reset link has been
            sent. Check your inbox (and spam folder).
          </p>
        ) : (
          <>
            <p className="mb-6 text-center text-sm text-zinc-600">
              Enter your email and we&apos;ll send you a link to reset your
              password.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block text-sm font-medium text-zinc-700"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                  placeholder="you@example.com"
                />
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-sm text-zinc-600">
          <Link
            href={loginPath}
            className="font-medium text-zinc-900 underline hover:text-zinc-700"
          >
            Back to Login
          </Link>
        </p>
      </div>
    </div>
  );
}
