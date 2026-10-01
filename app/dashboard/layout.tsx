import DashboardShell from "./dashboard-shell";
import { getMiddlewareTrustDiagnostics } from "@/utils/middleware-trust-diagnostics";
import AssistantChatWidget from "@/components/ai-assistant/assistant-chat-widget";
import { StickyBottomBarProvider } from "@/components/sticky-bottom-bar";
import { FeedbackShell } from "@/components/feedback";
import { loadDashboardShellData } from "@/utils/dashboard-shell-data";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  beginLayoutHttpPerfProbe,
  consumeLayoutHttpPerfSnapshot,
  formatLayoutPerfMetaContent,
  getLayoutProbeRequestKey,
  getSupabaseHttpPerfSnapshot,
  mergeSupabaseHttpPerfSnapshots,
  runWithSupabaseHttpPerfScope,
} from "@/lib/supabase-http-perf";
import { isPerfProbeEnabled } from "@/utils/perf-probe";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

async function DashboardLayoutInner({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const renderStartedAt = Date.now();
  let layoutProbeKey: string | null = null;
  if (isPerfProbeEnabled()) {
    layoutProbeKey = await getLayoutProbeRequestKey();
    if (layoutProbeKey) {
      beginLayoutHttpPerfProbe(layoutProbeKey);
    }
  }

  const shell = await loadDashboardShellData();
  const trustDiag =
    process.env.DFOMS_TRUST_DIAG === "true"
      ? await getMiddlewareTrustDiagnostics()
      : null;

  const layoutPerfMeta = isPerfProbeEnabled()
    ? (() => {
        const snapshot = mergeSupabaseHttpPerfSnapshots(
          getSupabaseHttpPerfSnapshot(),
          layoutProbeKey
            ? consumeLayoutHttpPerfSnapshot(layoutProbeKey)
            : null,
        );
        if (!snapshot) {
          return null;
        }
        return formatLayoutPerfMetaContent({
          renderMs: Date.now() - renderStartedAt,
          snapshot,
        });
      })()
    : null;

  return (
    <StickyBottomBarProvider>
      <FeedbackShell>
      {trustDiag ? (
        <meta
          name="dfoms-trust-source"
          content={`${trustDiag.trustSource};ctx=${trustDiag.ctxHeaderPresent};echo=${trustDiag.mwEchoPresent};clientEcho=${trustDiag.clientEchoVisible}`}
        />
      ) : null}
      {layoutPerfMeta ? (
        <meta name="dfoms-perf-layout" content={layoutPerfMeta} />
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
      </FeedbackShell>
    </StickyBottomBarProvider>
  );
}

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (isPerfProbeEnabled()) {
    return runWithSupabaseHttpPerfScope(() =>
      DashboardLayoutInner({ children }),
    );
  }
  return DashboardLayoutInner({ children });
}
