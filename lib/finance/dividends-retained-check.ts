import { fetchBalanceSheetPageData } from "@/app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
  standardBalanceSheetReportExtrasForView,
} from "@/lib/finance/balance-sheet-standard-report";
import type { SupabaseClient } from "@supabase/supabase-js";
export async function getRetainedEarningsAsOfDate(input: {
  supabase: SupabaseClient;
  tenantId: string;
  businessUnitId: string;
  asOfDate: string;
}): Promise<{ retainedEarnings: number | null; error: string | null }> {
  const date = input.asOfDate.slice(0, 10);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (!year || month < 1 || month > 12) {
    return { retainedEarnings: null, error: "Invalid as-of date." };
  }

  const pageData = await fetchBalanceSheetPageData(input.supabase, input.tenantId, {
    activeBusinessUnitId: input.businessUnitId,
    viewAllBusinessUnits: false,
    financialYear: year,
  });

  if (pageData.fetchError) {
    return { retainedEarnings: null, error: pageData.fetchError };
  }

  const report = buildStandardBalanceSheetReport(
    pageData,
    input.tenantId,
    year,
    standardBalanceSheetReportExtrasForView({
      viewAllBusinessUnits: false,
      activeBusinessUnitId: input.businessUnitId,
    }),
  );

  const reRow = report.rows.find((row) => row.key === "retained-earnings");
  const monthIndex = month - 1;
  const retainedEarnings = reRow?.amounts[monthIndex] ?? null;
  if (retainedEarnings === null) {
    return { retainedEarnings: null, error: "Could not read retained earnings." };
  }

  return { retainedEarnings, error: null };
}

export async function isBalanceSheetBalancedAsOf(input: {
  supabase: SupabaseClient;
  tenantId: string;
  businessUnitId: string | null;
  viewAllBusinessUnits: boolean;
  year: number;
  monthIndex: number;
}): Promise<boolean> {
  const pageData = await fetchBalanceSheetPageData(input.supabase, input.tenantId, {
    activeBusinessUnitId: input.businessUnitId,
    viewAllBusinessUnits: input.viewAllBusinessUnits,
    financialYear: input.year,
  });
  if (pageData.fetchError) {
    return false;
  }

  const report = buildStandardBalanceSheetReport(
    pageData,
    input.tenantId,
    input.year,
    standardBalanceSheetReportExtrasForView({
      viewAllBusinessUnits: input.viewAllBusinessUnits,
      activeBusinessUnitId: input.businessUnitId,
      rawManualFinancialEntries: pageData.initialRawManualEntries,
    }),
  );

  return getBalanceSheetMonthCheck(report, input.monthIndex).isBalanced;
}
