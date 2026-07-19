import DashboardShell from "./dashboard-shell";
import { getCurrentUserRole, hasLeaveApprovalInbox, isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";
import { getCurrentTenantBranding } from "@/utils/tenant-branding";
import { getUserDisplayInfo } from "@/utils/user-display";
import { ensureTrialAccess } from "@/utils/trial-enforcement";
import type { AppRole } from "@/app/dashboard/user-account-types";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await ensureTrialAccess();

  const [displayInfo, userRole, showLeaveApprovals, showPlatformSettings, tenantBranding] =
    await Promise.all([
      getUserDisplayInfo(),
      getCurrentUserRole(),
      hasLeaveApprovalInbox(),
      isDavorsPlatformSuperAdmin(),
      getCurrentTenantBranding(),
    ]);

  return (
    <DashboardShell
      userRole={userRole as AppRole | null}
      showLeaveApprovals={showLeaveApprovals}
      showPlatformSettings={showPlatformSettings}
      tenantBranding={tenantBranding}
      userLabel={displayInfo.label}
      userPhotoUrl={displayInfo.photoUrl}
      userFullName={displayInfo.fullName ?? displayInfo.email}
    >
      {children}
    </DashboardShell>
  );
}
