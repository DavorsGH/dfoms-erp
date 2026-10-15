import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardPageData } from "@/app/dashboard/dashboard-page-data";
import type { DashboardViewModel } from "@/app/dashboard/dashboard-utils";
import {
  buildDirectorScorecardByMonthKey,
  fetchDirectorScorecardClientInvoices,
  mergeTaxSettingsDueRules,
} from "@/app/dashboard/director-scorecard-build";
import { TAX_SETTINGS_FULL_SELECT } from "@/app/dashboard/finance/tax-utils";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";
import { scopeTaxSettingsRead } from "@/utils/phase5e-key-structure";

export async function attachDirectorScorecardToViewModel(
  supabase: SupabaseClient,
  tenantId: string,
  activeBusinessUnitId: string | null,
  buScope: BusinessUnitReadScope,
  viewModel: DashboardViewModel,
  dashboardPageData: DashboardPageData,
): Promise<DashboardViewModel> {
  const [clientInvoices, { data: taxSettingsRow }] = await Promise.all([
    fetchDirectorScorecardClientInvoices(supabase, tenantId, buScope),
    scopeTaxSettingsRead(
      supabase
        .from("tax_settings")
        .select(TAX_SETTINGS_FULL_SELECT)
        .eq("tenant_id", tenantId),
      activeBusinessUnitId,
    ).maybeSingle(),
  ]);

  const directorScorecardByMonthKey = buildDirectorScorecardByMonthKey({
    viewModel,
    dashboardPageData,
    budgetReportData: dashboardPageData.budgetVsActualReportData,
    clientInvoices,
    taxSettings: mergeTaxSettingsDueRules(
      (taxSettingsRow as Record<string, unknown> | null) ?? null,
    ),
  });

  return {
    ...viewModel,
    directorScorecardByMonthKey,
  };
}
