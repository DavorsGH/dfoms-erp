import Link from "next/link";
import type { Metadata } from "next";
import DavSuiteMark from "@/components/davsuite-mark";
import PortalPropertyManagementMobile from "./portal-property-management-section";

export const metadata: Metadata = {
  title: "Portals",
  description:
    "Sign in to DavSuite, or choose the landlord, tenant, or facility manager portal.",
};

const cardClassName =
  "flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm";

const primaryButtonClassName =
  "inline-flex w-full items-center justify-center rounded-md bg-[#0f2744] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] sm:w-auto sm:min-w-[8.5rem]";

const signUpLinkClassName =
  "font-semibold text-[#0f2744] underline underline-offset-2 transition-colors hover:text-[#1a3a5c]";

const signUpPromptClassName =
  "flex flex-col items-center gap-0.5 text-center text-sm text-slate-600";

export default function PortalChooserPage() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-[#0F2744] px-4 py-10 sm:py-14">
      <div className="w-full max-w-5xl">
        <header className="text-center">
          <div className="mb-4 flex flex-col items-center justify-center gap-3 sm:flex-row sm:items-center sm:gap-3.5">
            <DavSuiteMark color="light" />
            <span className="text-xl font-bold tracking-[0.18em] text-white sm:text-2xl">
              DAVSUITE
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">
            Choose your portal to continue
          </p>
        </header>

        <main className="mt-8 space-y-8 sm:mt-10 sm:space-y-10">
          <section>
            <h2 className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-300 sm:text-sm">
              DAVSUITE ERP
            </h2>
            <div
              className={`${cardClassName} border-[#0f2744]/20 p-7 shadow-md sm:p-8`}
            >
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="sm:max-w-xl">
                  <h3 className="text-xl font-semibold text-[#0f2744] sm:text-2xl">
                    DavSuite Enterprise Management System
                  </h3>
                  <p className="mt-2 text-sm text-slate-600 sm:text-base">
                    For businesses on the main platform — finance, HR, CRM,
                    inventory, and operations in one workspace.
                  </p>
                </div>
                <div className="w-full space-y-3 sm:w-auto sm:min-w-[8.5rem]">
                  <Link href="/login" className={primaryButtonClassName}>
                    Log In
                  </Link>
                  <div className={signUpPromptClassName}>
                    <span>New business?</span>
                    <Link href="/signup" className={signUpLinkClassName}>
                      Sign Up
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 hidden text-center text-xs font-semibold uppercase tracking-wider text-slate-300 sm:text-sm md:block">
              DAVSUITE PROPERTIES
            </h2>

            <PortalPropertyManagementMobile />

            <div className="hidden gap-5 md:grid md:grid-cols-3">
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
                  <div className={signUpPromptClassName}>
                    <span>New landlord?</span>
                    <Link
                      href="/landlord-portal/signup"
                      className={signUpLinkClassName}
                    >
                      Sign Up
                    </Link>
                  </div>
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

              <section className={cardClassName}>
                <h3 className="text-lg font-semibold text-[#0f2744]">
                  I&apos;m a Facility Manager
                </h3>
                <p className="mt-2 flex-1 text-sm text-slate-600">
                  Manage maintenance, complaints, and services for your assigned
                  properties.
                </p>
                <div className="mt-6 space-y-3">
                  <Link
                    href="/facility-portal/login"
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
