"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/password-input";
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
import { landlordPortalLoginWithPassword } from "../login/actions";

export default function LandlordPortalSignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validatePasswordClient(password, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    const response = await fetch("/api/landlord-portal/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        phone,
        address,
        password,
        confirm_password: confirmPassword,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      email?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to create account.");
      setLoading(false);
      return;
    }

    const loginEmail = payload?.email?.trim() || email.trim();
    const loginResult = await landlordPortalLoginWithPassword(
      loginEmail,
      password,
    );

    if (!loginResult.ok) {
      setError(
        `${loginResult.error} Your account was created — please sign in.`,
      );
      setLoading(false);
      router.push("/landlord-portal/login");
      return;
    }

    router.push("/landlord-portal/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0F2744] px-4 py-10">
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
          Landlord Signup
        </h1>
        <p className="mb-6 text-center text-sm text-slate-600">
          Create your Landlord Portal account. Davors staff will review and
          approve before full access is enabled.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className={portalLabelClassName}>
              Business / landlord name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={portalAuthInputClassName}
              placeholder="Your company or name"
            />
          </div>

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
            <label htmlFor="phone" className={portalLabelClassName}>
              Phone
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              className={portalAuthInputClassName}
              placeholder="+233…"
            />
          </div>

          <div>
            <label htmlFor="address" className={portalLabelClassName}>
              Address
            </label>
            <textarea
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              rows={2}
              className={portalAuthInputClassName}
              placeholder="Business or contact address"
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
              minLength={PASSWORD_MIN_LENGTH}
              className={portalAuthInputClassName}
              placeholder="At least 8 characters"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className={portalLabelClassName}>
              Confirm password
            </label>
            <PasswordInput
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              className={portalAuthInputClassName}
              placeholder="Re-enter password"
            />
          </div>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className={portalAuthPrimaryButtonClassName}
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link
            href="/landlord-portal/login"
            className="font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
