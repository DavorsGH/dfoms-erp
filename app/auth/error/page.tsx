import Link from "next/link";
import { mapOAuthErrorMessage } from "@/lib/auth/oauth-error-messages";
import { parseOAuthPersona } from "@/lib/auth/oauth-types";

type AuthErrorPageProps = {
  searchParams: Promise<{ persona?: string; message?: string }>;
};

function loginPathForPersona(persona: string): string {
  switch (parseOAuthPersona(persona)) {
    case "lessee":
      return "/portal/login";
    case "landlord":
      return "/landlord-portal/login";
    case "facility_manager":
      return "/facility-portal/login";
    case "staff":
    default:
      return "/login";
  }
}

function personaLabel(persona: string): string {
  switch (parseOAuthPersona(persona)) {
    case "lessee":
      return "Tenant Portal";
    case "landlord":
      return "Landlord Portal";
    case "facility_manager":
      return "Facility Manager Portal";
    case "staff":
    default:
      return "Staff ERP";
  }
}

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const params = await searchParams;
  const persona = params.persona ?? "staff";
  const message = mapOAuthErrorMessage(
    params.message?.trim() ||
      "We could not complete sign-in. Please try again or contact support.",
    { persona },
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0F2744] px-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-center text-2xl font-semibold text-zinc-900">
          Sign-in problem
        </h1>
        <p className="mb-4 text-center text-sm text-zinc-600">
          {personaLabel(persona)}
        </p>
        <p className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {message}
        </p>
        <Link
          href={loginPathForPersona(persona)}
          className="block w-full rounded-md bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-zinc-700"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
