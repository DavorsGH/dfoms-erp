"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  portalAuthCardClassName,
  portalAuthPrimaryButtonClassName,
} from "../portal-ui";

export default function LandlordPortalVerifyEmailPage() {
  const [status, setStatus] = useState<
    "verifying" | "activating" | "success" | "error"
  >("verifying");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  useEffect(() => {
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");

    if (!tokenHash || type !== "signup") {
      setStatus("error");
      setError("This verification link is invalid or missing required parameters.");
      return;
    }

    async function verifyAndActivate() {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: "signup",
      });

      if (verifyError) {
        setStatus("error");
        setError(
          "This verification link is invalid or has expired. Sign up again or contact support if you need help.",
        );
        return;
      }

      setStatus("activating");

      const confirmResponse = await fetch("/api/landlord-portal/confirm-email", {
        method: "POST",
      });

      const payload = (await confirmResponse.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!confirmResponse.ok) {
        setStatus("error");
        setError(
          payload?.error ??
            "Your email was verified but we could not activate your account. Try signing in or contact support.",
        );
        return;
      }

      setStatus("success");
      setTimeout(() => {
        router.push("/landlord-portal/dashboard");
        router.refresh();
      }, 2000);
    }

    void verifyAndActivate();
  }, [searchParams, supabase, router]);

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
        <h1 className="mb-6 text-center text-2xl font-semibold text-[#0f2744]">
          Verify Email
        </h1>

        {status === "verifying" ? (
          <p className="text-center text-sm text-slate-600">
            Verifying your email…
          </p>
        ) : null}

        {status === "activating" ? (
          <p className="text-center text-sm text-slate-600">
            Activating your Landlord Portal account…
          </p>
        ) : null}

        {status === "success" ? (
          <p className="text-center text-sm text-slate-700">
            Email verified and account activated! Redirecting to your dashboard…
          </p>
        ) : null}

        {status === "error" ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <a
              href="/landlord-portal/login"
              className={`inline-block ${portalAuthPrimaryButtonClassName}`}
            >
              Back to Sign in
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
