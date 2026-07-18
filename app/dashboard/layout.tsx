import DashboardShell from "./dashboard-shell";
import { getCurrentUserRole, hasLeaveApprovalInbox } from "@/utils/dashboard-auth";
import { getUserDisplayInfo } from "@/utils/user-display";
import { ensureTrialAccess } from "@/utils/trial-enforcement";
import type { AppRole } from "@/app/dashboard/user-account-types";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await ensureTrialAccess();

  const [displayInfo, userRole, showLeaveApprovals] = await Promise.all([
    getUserDisplayInfo(),
    getCurrentUserRole(),
    hasLeaveApprovalInbox(),
  ]);

  return (
    <DashboardShell
      userRole={userRole as AppRole | null}
      showLeaveApprovals={showLeaveApprovals}
      userLabel={displayInfo.label}
      userPhotoUrl={displayInfo.photoUrl}
      userFullName={displayInfo.fullName ?? displayInfo.email}
    >
      {children}
    </DashboardShell>
  );
}
