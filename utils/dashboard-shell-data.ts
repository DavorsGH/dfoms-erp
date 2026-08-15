import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  getCurrentAuthUser,
  getCurrentUserAccount,
  getCurrentUserRole,
  hasLeaveApprovalInbox,
  isDavorsPlatformRealEstateStaff,
  isDavorsPlatformSuperAdmin,
} from "@/utils/dashboard-auth";
import { getCurrentTenantBranding } from "@/utils/tenant-branding";
import { getUserDisplayInfo } from "@/utils/user-display";
import type { UserDisplayInfo } from "@/utils/user-display";
import type { TenantBranding } from "@/utils/tenant-branding-types";
import { ensureTrialAccess } from "@/utils/trial-enforcement";
import { ensureSecurityNotifications } from "@/utils/security-notifications";
import { createPerfProbe, isPerfProbeEnabled } from "@/utils/perf-probe";

export type DashboardShellData = {
  displayInfo: UserDisplayInfo;
  userRole: AppRole | null;
  showLeaveApprovals: boolean;
  showPlatformSettings: boolean;
  showRealEstate: boolean;
  tenantBranding: TenantBranding;
  authUser: Awaited<ReturnType<typeof getCurrentAuthUser>>;
  account: Awaited<ReturnType<typeof getCurrentUserAccount>>;
  perf?: ReturnType<typeof createPerfProbe>;
};

export async function loadDashboardShellData(): Promise<DashboardShellData> {
  const perf = createPerfProbe();

  await ensureTrialAccess();

  const [
    displayInfo,
    userRole,
    showLeaveApprovals,
    showPlatformSettings,
    showRealEstate,
    tenantBranding,
    authUser,
    account,
  ] = await Promise.all([
    getUserDisplayInfo(),
    getCurrentUserRole(),
    hasLeaveApprovalInbox(),
    isDavorsPlatformSuperAdmin(),
    isDavorsPlatformRealEstateStaff(),
    getCurrentTenantBranding(),
    getCurrentAuthUser(),
    getCurrentUserAccount(),
  ]);

  if (authUser && account?.tenant_id) {
    await ensureSecurityNotifications({
      authUid: authUser.id,
      persona: "staff",
      tenantId: account.tenant_id,
      passwordActionUrl: "/dashboard/my-account",
      mfaActionUrl: "/dashboard/my-account/mfa",
    });
  }

  if (isPerfProbeEnabled()) {
    console.info(
      "[perf] dashboard-shell",
      JSON.stringify({
        ms: perf.elapsedMs(),
        authCalls: perf.authCalls,
        dbCalls: perf.dbCalls,
        skippedAuthCalls: perf.skippedAuthCalls,
        skippedDbCalls: perf.skippedDbCalls,
      }),
    );
  }

  return {
    displayInfo,
    userRole: userRole as AppRole | null,
    showLeaveApprovals,
    showPlatformSettings,
    showRealEstate,
    tenantBranding,
    authUser,
    account,
    perf: isPerfProbeEnabled() ? perf : undefined,
  };
}
