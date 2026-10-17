import "server-only";

import { attachDirectorScorecardToViewModel } from "@/app/dashboard/director-scorecard-load";
import { fetchDashboardPageData } from "@/app/dashboard/dashboard-page-data";
import { buildOwnerDashboardViewModel } from "@/app/dashboard/owner-dashboard-view-model";
import { directorScorecardChecklistStatusLabel } from "@/app/dashboard/director-scorecard-checklist-utils";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DeclareReadinessWarning = {
  code: "gross_exceeds_quarter_available" | "checklist_not_ready";
  message: string;
};

export async function loadDividendDeclareReadiness(input: {
  supabase: SupabaseClient;
  tenantId: string;
  businessUnitId: string;
  declarationDate: string;
  grossAmount: number;
}): Promise<{ warnings: DeclareReadinessWarning[]; error: string | null }> {
  const date = input.declarationDate.slice(0, 10);
  const monthKey = date.slice(0, 7);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits: false,
    activeBusinessUnitId: input.businessUnitId,
  });

  const dashboardPageData = await fetchDashboardPageData(
    input.supabase,
    input.tenantId,
    {
      activeBusinessUnitId: input.businessUnitId,
      viewAllBusinessUnits: false,
    },
  );
  if (dashboardPageData.fetchError) {
    return { warnings: [], error: dashboardPageData.fetchError };
  }

  let viewModel = await buildOwnerDashboardViewModel(
    dashboardPageData,
    input.tenantId,
    { supabase: input.supabase, buScope },
  );
  viewModel = await attachDirectorScorecardToViewModel(
    input.supabase,
    input.tenantId,
    input.businessUnitId,
    buScope,
    viewModel,
    dashboardPageData,
  );

  const snapshot =
    viewModel.directorScorecardByMonthKey?.[monthKey] ??
    viewModel.directorScorecardByMonthKey?.[viewModel.defaultMonthKey];
  if (!snapshot) {
    return {
      warnings: [],
      error: "Could not load Director scorecard for this declaration date.",
    };
  }

  const warnings: DeclareReadinessWarning[] = [];
  const available = snapshot.dividendQuarter.gross;
  if (input.grossAmount > available + 0.005) {
    warnings.push({
      code: "gross_exceeds_quarter_available",
      message: `Gross ${formatGHS(input.grossAmount)} exceeds dividend available this quarter (${formatGHS(available)}) for this business unit.`,
    });
  }

  if (!snapshot.checklist.ready) {
    const failing = snapshot.checklist.items.filter(
      (item) => item.chipStatus !== "done" && item.chipStatus !== "not-enough-data",
    );
    const summary = failing
      .map(
        (item) =>
          `${item.label}: ${directorScorecardChecklistStatusLabel(item.chipStatus)} — ${item.reason}`,
      )
      .join("; ");
    warnings.push({
      code: "checklist_not_ready",
      message:
        summary ||
        "The “Ready to pay a dividend?” checklist is not complete for this month.",
    });
  }

  return { warnings, error: null };
}
