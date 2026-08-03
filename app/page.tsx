import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Davors Facilities — Portals",
  description: "Sign in to the DFOMS ERP Suite, landlord portal, or tenant portal.",
};

const cardClassName =
  "flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm";

const primaryButtonClassName =
  "inline-flex w-full items-center justify-center rounded-md bg-[#0f2744] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] sm:w-auto sm:min-w-[8.5rem]";

export default function PortalChooserPage() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-[#0F2744] px-4 py-10 sm:py-14">
      <div className="w-full max-w-3xl">
        <header className="text-center">
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
          <h1 className="text-2xl font-semibold text-white sm:text-3xl">
            Davors Facilities
          </h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">
            Choose your portal to continue
          </p>
        </header>

        <main className="mt-8 space-y-8 sm:mt-10 sm:space-y-10">
          <section>
            <h2 className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-300 sm:text-sm">
              Business ERP
            </h2>
            <div
              className={`${cardClassName} border-[#0f2744]/20 p-7 shadow-md sm:p-8`}
            >
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="sm:max-w-xl">
                  <h3 className="text-xl font-semibold text-[#0f2744] sm:text-2xl">
                    DFOMS ERP Suite
                  </h3>
                  <p className="mt-2 text-sm text-slate-600 sm:text-base">
                    For businesses subscribed to the main platform — finance,
                    HR, CRM, inventory, and operations in one workspace.
                  </p>
                </div>
                <div className="w-full space-y-3 sm:w-auto sm:min-w-[8.5rem]">
                  <Link href="/login" className={primaryButtonClassName}>
                    Log In
                  </Link>
                  <p className="text-center text-sm text-slate-600">
                    New to DFOMS?{" "}
                    <Link
                      href="/signup"
                      className="font-medium text-[#0f2744] underline-offset-2 hover:underline"
                    >
                      Sign Up
                    </Link>
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-300 sm:text-sm">
              Property Management
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
              <section className={cardClassName}>
                <h3 className="text-lg font-semibold text-[#0f2744]">
                  I&apos;m a Landlord
                </h3>
                <p className="mt-2 flex-1 text-sm text-slate-600">
                  View properties, leases, rent collection, and maintenance for
                  your portfolio.
                </p>
                <div className="mt-6 space-y-3">
                  <Link
                    href="/landlord-portal/login"
                    className="inline-flex w-full items-center justify-center rounded-md bg-[#0f2744] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
                  >
                    Log In
                  </Link>
                  <p className="text-center text-sm text-slate-600">
                    New landlord?{" "}
                    <Link
                      href="/landlord-portal/signup"
                      className="font-medium text-[#0f2744] underline-offset-2 hover:underline"
                    >
                      Sign Up
                    </Link>
                  </p>
                </div>
              </section>

              <section className={cardClassName}>
                <h3 className="text-lg font-semibold text-[#0f2744]">
                  I&apos;m a Tenant
                </h3>
                <p className="mt-2 flex-1 text-sm text-slate-600">
                  View your lease, pay rent, and submit maintenance requests.
                </p>
                <div className="mt-6 space-y-3">
                  <Link
                    href="/portal/login"
                    className="inline-flex w-full items-center justify-center rounded-md bg-[#0f2744] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
                  >
                    Log In
                  </Link>
                  <p className="text-center text-xs text-slate-500">
                    Your landlord will send you an invite.
                  </p>
                </div>
              </section>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
