import { BS_INTEGRITY_FAILURE_THRESHOLD } from "@/utils/balance-sheet-integrity-constants";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  BALANCE_TOLERANCE,
} from "@/app/dashboard/finance/balance-sheet-utils";
import { fetchBalanceSheetPageData } from "@/app/dashboard/finance/balance-sheet-page-data";
import type { SystemEventStatus } from "@/utils/system-event-log-types";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export type BalanceSheetMonthImbalance = {
  monthIndex: number;
  monthLabel: string;
  diff: number;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
};

export type TenantBalanceSheetIntegrityResult = {
  tenantId: string;
  tenantName: string;
  fiscalYear: number;
  monthsChecked: number[];
  imbalances: BalanceSheetMonthImbalance[];
  maxAbsDiff: number;
  status: SystemEventStatus;
  fetchError: string | null;
  durationMs: number;
};

export type BalanceSheetIntegrityRunResult = {
  runId: string;
  referenceDate: string;
  fiscalYear: number;
  tenantsChecked: number;
  balanced: number;
  warnings: number;
  failures: number;
  fetchErrors: number;
  tenantResults: TenantBalanceSheetIntegrityResult[];
  durationMs: number;
};

function roundCurrency(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function resolveClosedMonthIndices(
  fiscalYear: number,
  referenceDate = new Date(),
): number[] {
  const refYear = referenceDate.getFullYear();
  const refMonthIndex = referenceDate.getMonth();

  if (refYear < fiscalYear) {
    return [];
  }

  if (refYear > fiscalYear) {
    return Array.from({ length: 12 }, (_, index) => index);
  }

  return Array.from({ length: refMonthIndex + 1 }, (_, index) => index);
}

export function classifyBalanceSheetIntegrityStatus(
  imbalances: BalanceSheetMonthImbalance[],
): SystemEventStatus {
  if (imbalances.length === 0) {
    return "success";
  }

  const maxAbsDiff = Math.max(...imbalances.map((row) => Math.abs(row.diff)));
  if (maxAbsDiff >= BS_INTEGRITY_FAILURE_THRESHOLD) {
    return "failure";
  }

  if (maxAbsDiff > BALANCE_TOLERANCE) {
    return "warning";
  }

  return "success";
}

export async function auditTenantBalanceSheetIntegrity(
  admin: SupabaseClient,
  tenant: { id: string; name: string },
  fiscalYear: number,
  referenceDate = new Date(),
): Promise<TenantBalanceSheetIntegrityResult> {
  const startedAt = Date.now();
  const monthsChecked = resolveClosedMonthIndices(fiscalYear, referenceDate);

  const data = await fetchBalanceSheetPageData(admin, tenant.id);
  if (data.fetchError) {
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      fiscalYear,
      monthsChecked,
      imbalances: [],
      maxAbsDiff: 0,
      status: "failure",
      fetchError: data.fetchError,
      durationMs: Date.now() - startedAt,
    };
  }

  const report = buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    fiscalYear,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    {
      tenantId: tenant.id,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );

  const imbalances: BalanceSheetMonthImbalance[] = [];
  for (const monthIndex of monthsChecked) {
    const check = getBalanceCheckForPeriod(report, monthIndex);
    if (!check.isBalanced) {
      imbalances.push({
        monthIndex,
        monthLabel: `${MONTH_LABELS[monthIndex]} ${fiscalYear}`,
        diff: roundCurrency(check.difference),
        totalAssets: roundCurrency(check.totalAssets),
        totalLiabilitiesAndEquity: roundCurrency(check.totalLiabilitiesAndEquity),
      });
    }
  }

  const maxAbsDiff =
    imbalances.length > 0
      ? Math.max(...imbalances.map((row) => Math.abs(row.diff)))
      : 0;

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    fiscalYear,
    monthsChecked,
    imbalances,
    maxAbsDiff: roundCurrency(maxAbsDiff),
    status: classifyBalanceSheetIntegrityStatus(imbalances),
    fetchError: null,
    durationMs: Date.now() - startedAt,
  };
}
