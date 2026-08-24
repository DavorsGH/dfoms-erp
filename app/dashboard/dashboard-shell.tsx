"use client";

import SessionOfflineBanner from "@/components/session-offline-banner";
import OfflineWriteQueueIndicator from "@/components/offline-write-queue-indicator";
import { WriteQueueProvider } from "@/components/write-queue-provider";
import { requestOfflineNavWarm } from "@/lib/offline-nav-warm";
import { useEffect, useState } from "react";
import type { AppRole } from "@/app/dashboard/user-account-types";
import type { TenantBranding } from "@/utils/tenant-branding-types";
import Sidebar from "./sidebar";
import TopBar from "./top-bar";
import { TenantBrandingProvider } from "./tenant-branding-context";

type DashboardShellProps = {
  children: React.ReactNode;
  userRole: AppRole | null;
  showLeaveApprovals: boolean;
  showPlatformSettings: boolean;
  showRealEstate: boolean;
  tenantBranding: TenantBranding;
  userLabel: string;
  userPhotoUrl?: string | null;
  userFullName?: string | null;
  tenantId?: string | null;
  authUid?: string | null;
};

export default function DashboardShell({
  children,
  userRole,
  showLeaveApprovals,
  showPlatformSettings,
  showRealEstate,
  tenantBranding,
  userLabel,
  userPhotoUrl,
  userFullName,
  tenantId = null,
  authUid = null,
}: DashboardShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!authUid) {
      return;
    }
    void requestOfflineNavWarm({
      avatarUrl: userPhotoUrl,
      workspaceLogoUrl: tenantBranding.workspaceLogoUrl,
    });
  }, [authUid, userPhotoUrl, tenantBranding.workspaceLogoUrl]);

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
    <TenantBrandingProvider branding={tenantBranding}>
      <WriteQueueProvider tenantId={tenantId} authUid={authUid}>
        <div className="flex min-h-screen min-w-0">
          <div className="hidden shrink-0 md:flex">
            <Sidebar
              userRole={userRole}
              showLeaveApprovals={showLeaveApprovals}
              showPlatformSettings={showPlatformSettings}
              showRealEstate={showRealEstate}
              tenantBranding={tenantBranding}
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
                <Sidebar
                  userRole={userRole}
                  showLeaveApprovals={showLeaveApprovals}
                  showPlatformSettings={showPlatformSettings}
                  showRealEstate={showRealEstate}
                  tenantBranding={tenantBranding}
                  onNavigate={closeMobileNav}
                  onClose={closeMobileNav}
                  mobile
                />
              </div>
            </>
          ) : null}

          <div className="flex min-h-screen min-w-0 flex-1 flex-col">
            <TopBar
              userRole={userRole}
              userLabel={userLabel}
              userPhotoUrl={userPhotoUrl}
              userFullName={userFullName}
              onMenuToggle={() => setMobileNavOpen((current) => !current)}
              mobileNavOpen={mobileNavOpen}
            />
            <main className="min-w-0 flex-1 overflow-x-hidden bg-slate-50 p-4 md:p-6">
              <div className="mb-3">
                <SessionOfflineBanner />
                <OfflineWriteQueueIndicator />
              </div>
              {children}
            </main>
          </div>
        </div>
      </WriteQueueProvider>
    </TenantBrandingProvider>
  );
}
