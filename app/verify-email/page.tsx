"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function VerifyEmailPage() {
  const [status, setStatus] = useState<"verifying" | "success" | "error">(
    "verifying",
  );
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

    supabase.auth
      .verifyOtp({ token_hash: tokenHash, type: "signup" })
      .then(({ error }) => {
        if (error) {
          setStatus("error");
          setError(
            "This verification link is invalid or has expired. You can still log in — try requesting a new confirmation email from your account settings.",
          );
          return;
        }
        setStatus("success");
        setTimeout(() => {
          router.push("/dashboard");
        }, 2000);
      });
  }, [searchParams, supabase, router]);

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
          Verify Email
        </h1>

        {status === "verifying" && (
          <p className="text-center text-sm text-zinc-600">
            Verifying your email…
          </p>
        )}

        {status === "success" && (
          <p className="text-center text-sm text-zinc-700">
            Email verified! Redirecting…
          </p>
        )}

        {status === "error" && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <a
              href="/login"
              className="inline-block text-sm font-medium text-zinc-900 underline hover:text-zinc-700"
            >
              Back to Login
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
