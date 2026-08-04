import Image from "next/image";
import {
  DAVORS_PLATFORM_LOGO,
  DEFAULT_COMPANY_LEGAL_NAME,
} from "@/utils/tenant-branding-types";
import PortalHeaderBrand from "@/components/portal-header-brand";
import PortalNav from "./portal-nav";
import PortalNotificationBell from "./portal-notification-bell";
import PortalSignOutButton from "./dashboard/sign-out-button";
import PortalHeaderAvatar from "@/components/portal-header-avatar";

type PortalShellProps = {
  fullName: string;
  photoUrl?: string | null;
  children: React.ReactNode;
};

/**
 * Shared Tenant Portal chrome — compact single-row header, nav, and footer.
 */
export default function PortalShell({
  fullName,
  photoUrl = null,
  children,
}: PortalShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="bg-[#0f2744] text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <PortalHeaderBrand variant="dark" />

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <PortalHeaderAvatar
              photoUrl={photoUrl}
              fullName={fullName}
              size="nav"
              className="ring-2 ring-white/25"
            />
            <span className="max-w-[5rem] truncate text-xs font-medium text-white/90 sm:max-w-[12rem] sm:text-sm">
              {fullName}
            </span>
            <PortalNotificationBell />
            <PortalSignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6 sm:pt-6">
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
