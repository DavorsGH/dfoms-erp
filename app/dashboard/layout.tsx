import DashboardShell from "./dashboard-shell";
import AssistantChatWidget from "@/components/ai-assistant/assistant-chat-widget";
import { loadDashboardShellData } from "@/utils/dashboard-shell-data";
import type { AppRole } from "@/app/dashboard/user-account-types";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shell = await loadDashboardShellData();

  return (
    <>
      <DashboardShell
        userRole={shell.userRole as AppRole | null}
        showLeaveApprovals={shell.showLeaveApprovals}
        showPlatformSettings={shell.showPlatformSettings}
        showRealEstate={shell.showRealEstate}
        tenantBranding={shell.tenantBranding}
        userLabel={shell.displayInfo.label}
        userPhotoUrl={shell.displayInfo.photoUrl}
        userFullName={shell.displayInfo.fullName ?? shell.displayInfo.email}
        tenantId={shell.account?.tenant_id ?? null}
        authUid={shell.authUser?.id ?? null}
      >
        {children}
      </DashboardShell>
      <AssistantChatWidget />
    </>
  );
}
