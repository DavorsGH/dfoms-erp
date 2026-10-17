import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDashboardPageData } from "@/app/dashboard/dashboard-page-data";
import type { DashboardPageData } from "@/app/dashboard/dashboard-page-data";
import type { DashboardViewModel } from "@/app/dashboard/dashboard-utils";
import type { DirectorScorecardSnapshot } from "@/app/dashboard/director-scorecard-build";
import {
  buildDirectorScorecardByMonthKey,
  fetchDirectorScorecardClientInvoices,
  mergeTaxSettingsDueRules,
} from "@/app/dashboard/director-scorecard-build";
import { buildOwnerDashboardViewModel } from "@/app/dashboard/owner-dashboard-view-model";
import { TAX_SETTINGS_FULL_SELECT } from "@/app/dashboard/finance/tax-utils";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  getActiveBusinessUnitId,
  getCurrentUserAccount,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { scopeTaxSettingsRead } from "@/utils/phase5e-key-structure";
import {
  loadTenantScorecardSettings,
  type DirectorScorecardSettingsMeta,
} from "@/lib/finance/director-scorecard-settings";

export type DirectorScorecardSessionScope = {
  tenantId: string;
  storedActiveBusinessUnitId: string | null;
  resolvedActiveBusinessUnitId: string | null;
  viewAllBusinessUnits: boolean;
  businessUnitLabel: string;
  buScope: BusinessUnitReadScope;
};

export async function resolveDirectorScorecardBusinessUnitLabel(
  tenantId: string,
  resolvedActiveBusinessUnitId: string | null,
  viewAllBusinessUnits: boolean,
): Promise<string> {
  if (viewAllBusinessUnits) {
    return "All businesses";
  }
  if (!resolvedActiveBusinessUnitId) {
    return "Workspace default (no unit selected)";
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("business_units")
    .select("name")
    .eq("id", resolvedActiveBusinessUnitId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return data?.name?.trim() || "Selected business unit";
}

/**
 * Same tenant / business-unit resolution as app/dashboard/page.tsx (lines 270–291).
 */
export async function resolveDirectorScorecardSessionScope(): Promise<
  | { scope: DirectorScorecardSessionScope; supabase: SupabaseClient }
  | { error: string }
> {
  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return { error: "Unable to resolve the current workspace." };
  }

  const account = await getCurrentUserAccount();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [resolvedActiveBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);

  const storedActiveBusinessUnitId =
    account?.active_business_unit_id?.trim() || null;

  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId: resolvedActiveBusinessUnitId,
  });

  const businessUnitLabel = await resolveDirectorScorecardBusinessUnitLabel(
    tenantId,
    resolvedActiveBusinessUnitId,
    viewAllBusinessUnits,
  );

  return {
    scope: {
      tenantId,
      storedActiveBusinessUnitId,
      resolvedActiveBusinessUnitId,
      viewAllBusinessUnits,
      businessUnitLabel,
      buScope,
    },
    supabase,
  };
}

export type DirectorScorecardSessionBundle = {
  scope: DirectorScorecardSessionScope;
  viewModel: DashboardViewModel;
  pageData: DashboardPageData;
  snapshot: DirectorScorecardSnapshot;
  monthSnapshot: DashboardViewModel["monthSnapshots"][string];
  monthKey: string;
  scorecardSettings: DirectorScorecardSettingsMeta;
};

/**
 * Loads dashboard + Director's Scorecard using the signed-in user's session scope
 * (matches Dashboard page and /api/dashboard/summary scorecard attachment).
 */
export async function loadDirectorScorecardForSession(
  monthKey: string,
): Promise<
  DirectorScorecardSessionBundle | { error: string; fetchWarning?: string | null }
> {
  const resolved = await resolveDirectorScorecardSessionScope();
  if ("error" in resolved) {
    return resolved;
  }

  const { scope, supabase } = resolved;

  const pageData = await fetchDashboardPageData(supabase, scope.tenantId, {
    activeBusinessUnitId: scope.resolvedActiveBusinessUnitId,
    viewAllBusinessUnits: scope.viewAllBusinessUnits,
  });

  let viewModel = await buildOwnerDashboardViewModel(pageData, scope.tenantId, {
    supabase,
    buScope: scope.buScope,
  });

  viewModel = await attachDirectorScorecardToViewModel(
    supabase,
    scope.tenantId,
    scope.resolvedActiveBusinessUnitId,
    scope.buScope,
    viewModel,
    pageData,
  );

  const resolvedMonthKey =
    viewModel.directorScorecardByMonthKey?.[monthKey] !== undefined
      ? monthKey
      : viewModel.defaultMonthKey;

  const snapshot = viewModel.directorScorecardByMonthKey?.[resolvedMonthKey];
  const monthSnapshot =
    viewModel.monthSnapshots[resolvedMonthKey] ??
    viewModel.monthSnapshots[viewModel.defaultMonthKey];

  if (!snapshot || !monthSnapshot) {
    return {
      error: `No Director's Scorecard snapshot for ${monthKey}.`,
      fetchWarning: pageData.fetchError,
    };
  }

  return {
    scope,
    viewModel,
    pageData,
    snapshot,
    monthSnapshot,
    monthKey: resolvedMonthKey,
    scorecardSettings:
      viewModel.directorScorecardSettings ??
      (await loadTenantScorecardSettings(supabase, scope.tenantId, {
        adminClient: createAdminClient(),
      })).meta,
  };
}

export async function attachDirectorScorecardToViewModel(
  supabase: SupabaseClient,
  tenantId: string,
  activeBusinessUnitId: string | null,
  buScope: BusinessUnitReadScope,
  viewModel: DashboardViewModel,
  dashboardPageData: DashboardPageData,
): Promise<DashboardViewModel> {
  const viewAllBusinessUnits = buScope.mode === "all";
  const admin = createAdminClient();
  const [clientInvoices, { data: taxSettingsRow }, businessUnitLabel, scorecardSettingsLoad] =
    await Promise.all([
      fetchDirectorScorecardClientInvoices(supabase, tenantId, buScope),
      scopeTaxSettingsRead(
        supabase
          .from("tax_settings")
          .select(TAX_SETTINGS_FULL_SELECT)
          .eq("tenant_id", tenantId),
        activeBusinessUnitId,
      ).maybeSingle(),
      resolveDirectorScorecardBusinessUnitLabel(
        tenantId,
        activeBusinessUnitId,
        viewAllBusinessUnits,
      ),
      loadTenantScorecardSettings(supabase, tenantId, { adminClient: admin }),
    ]);

  const directorScorecardByMonthKey = buildDirectorScorecardByMonthKey({
    viewModel,
    dashboardPageData,
    budgetReportData: dashboardPageData.budgetVsActualReportData,
    clientInvoices,
    taxSettings: mergeTaxSettingsDueRules(
      (taxSettingsRow as Record<string, unknown> | null) ?? null,
    ),
    businessUnitLabel,
    planning: scorecardSettingsLoad.planning,
    scorecardBusinessUnitId:
      buScope.mode === "unit"
        ? buScope.id
        : activeBusinessUnitId?.trim() || null,
  });

  return {
    ...viewModel,
    directorScorecardByMonthKey,
    directorScorecardSettings: scorecardSettingsLoad.meta,
  };
}
