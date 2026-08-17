"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StayLoggedInCheckbox from "@/components/auth/stay-logged-in-checkbox";
import OAuthProviderButtons from "@/components/auth/oauth-provider-buttons";
import PasswordInput from "@/components/password-input";
import { getSafeNext } from "@/utils/safe-redirect";
import { loginWithPassword } from "./actions";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stayLoggedIn, setStayLoggedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await loginWithPassword(email, password, stayLoggedIn);

    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    const destination = getSafeNext(searchParams.get("next"), "/dashboard");

    if (result.mfaRequired) {
      const params = new URLSearchParams();
      params.set("next", destination);
      params.set("method", result.method);
      router.push(`/login/mfa?${params.toString()}`);
      router.refresh();
      return;
    }

    router.push(destination);
    router.refresh();
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
        <h1 className="mb-6 text-center text-2xl font-semibold text-zinc-900">
          Davors Facilities ERP
        </h1>

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
              placeholder="you@company.com"
            />
          </div>

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
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
              placeholder="••••••••"
            />
          </div>

          <StayLoggedInCheckbox
            checked={stayLoggedIn}
            onChange={setStayLoggedIn}
          />

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
          <p className="text-center text-sm text-zinc-600">
            <a href="/forgot-password" className="font-medium text-zinc-900 underline hover:text-zinc-700">
              Forgot Password?
            </a>
          </p>
        </form>

        <div className="mt-4">
          <OAuthProviderButtons
            persona="staff"
            flow="login"
            next={searchParams.get("next")}
          />
        </div>
      </div>
    </div>
  );
}
