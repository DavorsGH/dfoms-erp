"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import StayLoggedInCheckbox from "@/components/auth/stay-logged-in-checkbox";
import OAuthProviderButtons from "@/components/auth/oauth-provider-buttons";
import PasswordInput from "@/components/password-input";
import {
  portalAuthCardClassName,
  portalAuthInputClassName,
  portalAuthPrimaryButtonClassName,
  portalLabelClassName,
} from "../portal-ui";
import { landlordPortalLoginWithPassword } from "./actions";

export default function LandlordPortalLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stayLoggedIn, setStayLoggedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await landlordPortalLoginWithPassword(
      email,
      password,
      stayLoggedIn,
    );

    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    if (result.mfaRequired) {
      const params = new URLSearchParams();
      params.set("next", "/landlord-portal/dashboard");
      params.set("method", result.method);
      router.push(`/landlord-portal/login/mfa?${params.toString()}`);
      router.refresh();
      return;
    }

    router.push("/landlord-portal/dashboard");
    router.refresh();
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
          Landlord Portal
        </h1>
        <p className="mb-6 text-center text-sm text-slate-600">
          Sign in to view your properties, leases, and rent collection.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className={portalLabelClassName}>
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={portalAuthInputClassName}
              placeholder="you@example.com"
            />
          </div>

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

          <StayLoggedInCheckbox
            checked={stayLoggedIn}
            onChange={setStayLoggedIn}
          />

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className={portalAuthPrimaryButtonClassName}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-4">
          <OAuthProviderButtons persona="landlord" flow="login" />
        </div>

        <p className="mt-6 text-center text-sm text-slate-600">
          New landlord?{" "}
          <Link
            href="/landlord-portal/signup"
            className="font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
          >
            Create an account
          </Link>
        </p>

        <p className="mt-4 text-center text-xs text-slate-500">
          Staff users should use the{" "}
          <Link
            href="/login"
            className="font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
          >
            ERP login
          </Link>
          . Tenants use the{" "}
          <Link
            href="/portal/login"
            className="font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
          >
            Tenant Portal
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
