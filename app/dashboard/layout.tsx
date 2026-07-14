import Sidebar from "./sidebar";
import TopBar from "./top-bar";
import { getCurrentUserRole, hasLeaveApprovalInbox } from "@/utils/dashboard-auth";
import { getUserDisplayInfo } from "@/utils/user-display";
import type { AppRole } from "@/app/dashboard/user-account-types";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [displayInfo, userRole, showLeaveApprovals] = await Promise.all([
    getUserDisplayInfo(),
    getCurrentUserRole(),
    hasLeaveApprovalInbox(),
  ]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        userRole={userRole as AppRole | null}
        showLeaveApprovals={showLeaveApprovals}
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar
          userLabel={displayInfo.label}
          userPhotoUrl={displayInfo.photoUrl}
          userFullName={displayInfo.fullName ?? displayInfo.email}
        />
        <main className="min-w-0 flex-1 overflow-x-auto bg-slate-50 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
