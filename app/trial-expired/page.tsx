import Image from "next/image";
import Link from "next/link";
import LogoutButton from "@/app/dashboard/logout-button";

const SUPPORT_EMAIL = "info@davorsfacilities.com";

export default function TrialExpiredPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0F2744] px-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
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
          Trial ended
        </h1>
        <p className="mb-6 text-center text-sm leading-relaxed text-zinc-600">
          Your free trial has ended. Contact us to continue using Davors
          Facilities ERP on your account.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="inline-flex w-full items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 sm:w-auto"
          >
            Contact us
          </a>
          <LogoutButton className="w-full sm:w-auto" />
        </div>
        <p className="mt-4 text-center text-xs text-zinc-500">
          Or email{" "}
          <Link
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-zinc-700 underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </Link>
        </p>
      </div>
    </div>
  );
}
