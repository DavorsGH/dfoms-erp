"use client";

import { useEffect, useState } from "react";
import SessionOfflineBanner from "@/components/session-offline-banner";
import type { FacilityPortalNavLink } from "./portal-nav-config";
import FacilityPortalSidebar from "./portal-sidebar";
import FacilityPortalTopBar from "./portal-top-bar";

type FacilityPortalDashboardShellProps = {
  children: React.ReactNode;
  userLabel: string;
  links: FacilityPortalNavLink[];
};

/**
 * Staff/landlord visual shell for Facility Manager Portal:
 * navy sidebar + white top bar + slate main.
 */
export default function FacilityPortalDashboardShell({
  children,
  userLabel,
  links,
}: FacilityPortalDashboardShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  return (
    <div className="flex min-h-screen min-w-0">
      <div className="hidden shrink-0 md:flex">
        <FacilityPortalSidebar links={links} />
      </div>

      {mobileNavOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation menu"
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={closeMobileNav}
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">
            <FacilityPortalSidebar
              links={links}
              onNavigate={closeMobileNav}
              onClose={closeMobileNav}
              mobile
            />
          </div>
        </>
      ) : null}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <FacilityPortalTopBar
          userLabel={userLabel}
          onMenuToggle={() => setMobileNavOpen((current) => !current)}
          mobileNavOpen={mobileNavOpen}
        />
        <main className="min-w-0 flex-1 overflow-x-hidden bg-slate-50 p-4 md:p-6">
          <div className="mb-3">
            <SessionOfflineBanner />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
