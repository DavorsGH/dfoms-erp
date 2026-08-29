import type { AppRole } from "@/app/dashboard/user-account-types";
import { isStaffBusinessUnitSwitcherRole } from "@/app/dashboard/user-account-role-utils";
import type { BusinessUnitSwitcherOption } from "@/app/dashboard/business-unit-switcher";
import {
  getActiveBusinessUnitId,
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
import { createAdminClient } from "@/utils/supabase/admin";

export type DashboardShellData = {
  displayInfo: UserDisplayInfo;
  userRole: AppRole | null;
  showLeaveApprovals: boolean;
  showPlatformSettings: boolean;
  showRealEstate: boolean;
  tenantBranding: TenantBranding;
  authUser: Awaited<ReturnType<typeof getCurrentAuthUser>>;
  account: Awaited<ReturnType<typeof getCurrentUserAccount>>;
  businessUnitSwitcher: {
    units: BusinessUnitSwitcherOption[];
    activeBusinessUnitId: string | null;
  } | null;
  perf?: ReturnType<typeof createPerfProbe>;
};

async function loadBusinessUnitSwitcherOptions(
  tenantId: string,
): Promise<BusinessUnitSwitcherOption[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error(
      "[dashboard-shell] business unit switcher load failed:",
      error.message,
    );
    return [];
  }

  return ((data ?? []) as Array<{ id: string; name: string }>).map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

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
    activeBusinessUnitId,
  ] = await Promise.all([
    getUserDisplayInfo(),
    getCurrentUserRole(),
    hasLeaveApprovalInbox(),
    isDavorsPlatformSuperAdmin(),
    isDavorsPlatformRealEstateStaff(),
    getCurrentTenantBranding(),
    getCurrentAuthUser(),
    getCurrentUserAccount(),
    getActiveBusinessUnitId(),
  ]);

  let businessUnitSwitcher: DashboardShellData["businessUnitSwitcher"] = null;
  if (isStaffBusinessUnitSwitcherRole(userRole) && account?.tenant_id) {
    const units = await loadBusinessUnitSwitcherOptions(account.tenant_id);
    if (units.length >= 1) {
      const activeStillListed =
        activeBusinessUnitId &&
        units.some((unit) => unit.id === activeBusinessUnitId)
          ? activeBusinessUnitId
          : null;
      businessUnitSwitcher = {
        units,
        activeBusinessUnitId: activeStillListed,
      };
    }
  }

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
    businessUnitSwitcher,
    perf: isPerfProbeEnabled() ? perf : undefined,
  };
}
