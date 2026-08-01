import Image from "next/image";
import {
  DAVORS_PLATFORM_LOGO,
  DEFAULT_COMPANY_LEGAL_NAME,
  DEFAULT_WORKSPACE_LOGO,
  DEFAULT_WORKSPACE_NAME,
} from "@/utils/tenant-branding-types";
import PortalNav from "./portal-nav";
import PortalNotificationBell from "./portal-notification-bell";
import PortalSignOutButton from "./dashboard/sign-out-button";

type PortalShellProps = {
  fullName: string;
  children: React.ReactNode;
};

/**
 * Shared Tenant Portal chrome — same navy sidebar colors, logo, wordmark,
 * and footer branding as the staff dashboard.
 */
export default function PortalShell({ fullName, children }: PortalShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="bg-[#0f2744] text-white">
        <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <Image
                src={DEFAULT_WORKSPACE_LOGO}
                alt={`${DEFAULT_WORKSPACE_NAME} logo`}
                width={80}
                height={80}
                className="h-16 w-16 shrink-0 rounded-sm object-cover sm:h-20 sm:w-20"
                priority
              />
              <div className="min-w-0 flex-1">
                <p className="break-words text-lg font-semibold leading-tight text-emerald-400">
                  {DEFAULT_WORKSPACE_NAME}
                </p>
                <p className="mt-0.5 text-sm font-medium leading-tight text-white/90">
                  Real Estate Portal
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <PortalNotificationBell />
              <PortalSignOutButton />
            </div>
          </div>
          <h1 className="mt-4 text-lg font-semibold text-white sm:text-xl">
            Welcome, {fullName}
          </h1>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 sm:pt-8">
        <PortalNav />
      </div>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6 sm:px-6">
        {children}
      </main>

      <footer className="mt-auto bg-[#0f2744] text-white">
        <div className="mx-auto max-w-3xl border-t border-white/10 px-4 py-4 sm:px-6">
          <p className="text-[10px] leading-snug text-white/45">
            © 2026 {DEFAULT_COMPANY_LEGAL_NAME}. All rights reserved.
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <Image
              src={DAVORS_PLATFORM_LOGO}
              alt="Davors"
              width={36}
              height={36}
              className="h-9 w-9 shrink-0 rounded-sm object-cover"
            />
            <p className="text-[10px] leading-snug text-white/45">
              Powered by Davors Facilities
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
