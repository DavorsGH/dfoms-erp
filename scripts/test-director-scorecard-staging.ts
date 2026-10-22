/**
 * Staging (Davors): Director's Scorecard parity and RBAC checks.
 *
 * Usage: npx tsx scripts/test-director-scorecard-staging.ts
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const CAANTA_BUSINESS_UNIT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function loadModules() {
  const [
    { buildOwnerDashboardViewModel },
    { fetchDashboardPageData },
    {
      buildDirectorScorecardByMonthKey,
      fetchDirectorScorecardClientInvoices,
      mergeTaxSettingsDueRules,
    },
    { ALL_PROJECTS_FILTER, buildBudgetVsActualReport },
    { monthIndexFromMonthNumber },
    { getDashboardVisibility },
    { resolveBusinessUnitReadScope },
    { TAX_SETTINGS_FULL_SELECT },
    { scopeTaxSettingsRead },
  ] = await Promise.all([
    import("../app/dashboard/owner-dashboard-view-model"),
    import("../app/dashboard/dashboard-page-data"),
    import("../app/dashboard/director-scorecard-build"),
    import("../app/dashboard/reports/budget-vs-actual-utils"),
    import("../app/dashboard/reports/finance-reports-utils"),
    import("../utils/rbac-access"),
    import("../utils/business-unit-view"),
    import("../app/dashboard/finance/tax-utils"),
    import("../utils/phase5e-key-structure"),
  ]);

  return {
    buildOwnerDashboardViewModel,
    fetchDashboardPageData,
    buildDirectorScorecardByMonthKey,
    fetchDirectorScorecardClientInvoices,
    mergeTaxSettingsDueRules,
    ALL_PROJECTS_FILTER,
    buildBudgetVsActualReport,
    monthIndexFromMonthNumber,
    getDashboardVisibility,
    resolveBusinessUnitReadScope,
    TAX_SETTINGS_FULL_SELECT,
    scopeTaxSettingsRead,
  };
}

async function buildScorecardForScope(
  modules: Awaited<ReturnType<typeof loadModules>>,
  options: {
  admin: ReturnType<typeof createClient>;
  viewAllBusinessUnits: boolean;
  activeBusinessUnitId: string | null;
  label: string;
},
) {
  const buScope = modules.resolveBusinessUnitReadScope({
    viewAllBusinessUnits: options.viewAllBusinessUnits,
    activeBusinessUnitId: options.activeBusinessUnitId,
  });
  const dashboardPageData = await modules.fetchDashboardPageData(
    options.admin,
    DAVORS_TENANT_ID,
    {
      activeBusinessUnitId: options.activeBusinessUnitId,
      viewAllBusinessUnits: options.viewAllBusinessUnits,
    },
  );
  const viewModel = await modules.buildOwnerDashboardViewModel(
    dashboardPageData,
    DAVORS_TENANT_ID,
    { supabase: options.admin, buScope },
  );
  const clientInvoices = await modules.fetchDirectorScorecardClientInvoices(
    options.admin,
    DAVORS_TENANT_ID,
    buScope,
  );
  const { data: taxSettingsRow } = await modules.scopeTaxSettingsRead(
    options.admin
      .from("tax_settings")
      .select(modules.TAX_SETTINGS_FULL_SELECT)
      .eq("tenant_id", DAVORS_TENANT_ID),
    options.activeBusinessUnitId,
  ).maybeSingle();

  const scorecards = modules.buildDirectorScorecardByMonthKey({
    viewModel,
    dashboardPageData,
    budgetReportData: dashboardPageData.budgetVsActualReportData,
    clientInvoices,
    taxSettings: modules.mergeTaxSettingsDueRules(
      (taxSettingsRow as Record<string, unknown> | null) ?? null,
    ),
    businessUnitLabel: options.label,
  });

  return { viewModel, scorecards, dashboardPageData, label: options.label };
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const modules = await loadModules();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && key, "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("RBAC: finance must not see scorecard flag");
  const financeVisibility = modules.getDashboardVisibility("finance");
  assert(
    financeVisibility.showDirectorScorecard === false,
    "finance role incorrectly has showDirectorScorecard",
  );
  const directorVisibility = modules.getDashboardVisibility("director");
  assert(
    directorVisibility.showDirectorScorecard === true,
    "director role missing showDirectorScorecard",
  );

  const allScope = await buildScorecardForScope(modules, {
    admin,
    viewAllBusinessUnits: true,
    activeBusinessUnitId: null,
    label: "All Businesses",
  });
  const caantaScope = await buildScorecardForScope(modules, {
    admin,
    viewAllBusinessUnits: false,
    activeBusinessUnitId: CAANTA_BUSINESS_UNIT_ID,
    label: "Caanta",
  });

  const monthKey =
    allScope.viewModel.defaultMonthKey ??
    allScope.viewModel.monthOptions.at(-1)?.key;
  assert(monthKey, "No dashboard month key");

  const scorecard = allScope.scorecards[monthKey];
  const snapshot = allScope.viewModel.monthSnapshots[monthKey];
  assert(scorecard && snapshot, "Missing scorecard or month snapshot");

  console.log(`Parity (${monthKey}): PBT vs dashboard net profit`);
  assert(
    Math.abs(scorecard.profitBeforeTax - snapshot.summary.netProfit) < 0.02,
    `PBT ${scorecard.profitBeforeTax} !== net profit ${snapshot.summary.netProfit}`,
  );

  const option = allScope.viewModel.monthOptions.find((row) => row.key === monthKey)!;
  const reportRows = modules.buildBudgetVsActualReport({
    budgets: allScope.dashboardPageData.budgetVsActualReportData.initialBudgets,
    expenses: allScope.dashboardPageData.budgetVsActualReportData.initialExpenses,
    rawMaterialPurchases:
      allScope.dashboardPageData.budgetVsActualReportData.initialRawMaterialPurchases,
    productPurchases:
      allScope.dashboardPageData.budgetVsActualReportData.initialProductPurchases,
    payrollRows:
      allScope.dashboardPageData.budgetVsActualReportData.initialPayrollRows,
    projects: allScope.dashboardPageData.budgetVsActualReportData.initialProjects,
    year: option.year,
    month: option.month,
    monthIndex: modules.monthIndexFromMonthNumber(option.month),
    projectFilter: modules.ALL_PROJECTS_FILTER,
    viewMode: "monthly-prorated",
  });
  assert(
    scorecard.budget.rows.length === reportRows.length,
    "Budget row count mismatch vs Budget vs Actual report",
  );
  for (let index = 0; index < reportRows.length; index += 1) {
    const left = scorecard.budget.rows[index];
    const right = reportRows[index];
    assert(left.rowKey === right.rowKey, `Row key mismatch at ${index}`);
    assert(
      Math.abs(left.actual - right.actual) < 0.02,
      `Actual mismatch for ${left.rowKey}`,
    );
  }

  console.log("Checklist items:");
  for (const item of scorecard.checklist.items) {
    console.log(
      `  [${item.chipStatus}] ${item.label}: ${item.reason}`,
    );
  }

  const caantaScorecard = caantaScope.scorecards[monthKey];
  assert(caantaScorecard, "Missing Caanta scorecard");
  assert(
    Math.abs(caantaScorecard.revenue) <= Math.abs(allScope.scorecards[monthKey].revenue) + 0.02,
    "Caanta revenue should not exceed All Businesses revenue",
  );
  if (caantaScorecard.revenue > 0 && allScope.scorecards[monthKey].revenue > 0) {
    assert(
      caantaScorecard.revenue < allScope.scorecards[monthKey].revenue ||
        caantaScorecard.revenue === allScope.scorecards[monthKey].revenue,
      "Caanta scoped revenue isolation check failed",
    );
  }

  console.log("OK: Director scorecard staging checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
