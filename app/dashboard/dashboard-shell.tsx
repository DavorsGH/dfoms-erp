"use client";

import { useEffect, useState } from "react";
import type { AppRole } from "@/app/dashboard/user-account-types";
import Sidebar from "./sidebar";
import TopBar from "./top-bar";

type DashboardShellProps = {
  children: React.ReactNode;
  userRole: AppRole | null;
  showLeaveApprovals: boolean;
  userLabel: string;
  userPhotoUrl?: string | null;
  userFullName?: string | null;
};

export default function DashboardShell({
  children,
  userRole,
  showLeaveApprovals,
  userLabel,
  userPhotoUrl,
  userFullName,
}: DashboardShellProps) {
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
        <Sidebar userRole={userRole} showLeaveApprovals={showLeaveApprovals} />
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
            <Sidebar
              userRole={userRole}
              showLeaveApprovals={showLeaveApprovals}
              onNavigate={closeMobileNav}
              onClose={closeMobileNav}
              mobile
            />
          </div>
        </>
      ) : null}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar
          userLabel={userLabel}
          userPhotoUrl={userPhotoUrl}
          userFullName={userFullName}
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
