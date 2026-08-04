"use client";

import { useEffect, useState } from "react";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import LandlordPortalSidebar from "./portal-sidebar";
import LandlordPortalTopBar from "./portal-top-bar";

type LandlordPortalDashboardShellProps = {
  children: React.ReactNode;
  userLabel: string;
  userPhotoUrl?: string | null;
  landlordType: LandlordType | null;
  showNav?: boolean;
};

/**
 * Staff-dashboard visual shell for Landlord Portal:
 * full navy sidebar + white top bar + slate main (not Tenant Portal header/footer).
 */
export default function LandlordPortalDashboardShell({
  children,
  userLabel,
  userPhotoUrl = null,
  landlordType,
  showNav = true,
}: LandlordPortalDashboardShellProps) {
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
        <LandlordPortalSidebar
          landlordType={landlordType}
          showNav={showNav}
        />
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
            <LandlordPortalSidebar
              landlordType={landlordType}
              showNav={showNav}
              onNavigate={closeMobileNav}
              onClose={closeMobileNav}
              mobile
            />
          </div>
        </>
      ) : null}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <LandlordPortalTopBar
          userLabel={userLabel}
          userPhotoUrl={userPhotoUrl}
          onMenuToggle={() => setMobileNavOpen((current) => !current)}
          mobileNavOpen={mobileNavOpen}
        />
        <main className="min-w-0 flex-1 overflow-x-hidden bg-slate-50 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
