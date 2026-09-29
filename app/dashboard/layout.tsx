import DashboardShell from "./dashboard-shell";
import { getMiddlewareTrustDiagnostics } from "@/utils/middleware-trust-diagnostics";
import AssistantChatWidget from "@/components/ai-assistant/assistant-chat-widget";
import { StickyBottomBarProvider } from "@/components/sticky-bottom-bar";
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
  const trustDiag =
    process.env.DFOMS_TRUST_DIAG === "true"
      ? await getMiddlewareTrustDiagnostics()
      : null;

  return (
    <StickyBottomBarProvider>
      {trustDiag ? (
        <meta
          name="dfoms-trust-source"
          content={`${trustDiag.trustSource};ctx=${trustDiag.ctxHeaderPresent};echo=${trustDiag.mwEchoPresent};clientEcho=${trustDiag.clientEchoVisible}`}
        />
      ) : null}
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
        businessUnitSwitcher={shell.businessUnitSwitcher}
      >
        {children}
      </DashboardShell>
      <AssistantChatWidget />
    </StickyBottomBarProvider>
  );
}
