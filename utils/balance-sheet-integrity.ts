import { BS_INTEGRITY_FAILURE_THRESHOLD } from "@/utils/balance-sheet-integrity-constants";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  BALANCE_TOLERANCE,
} from "@/app/dashboard/finance/balance-sheet-utils";
import {
  buildCustomerCreditsBalanceSheetOptions,
  fetchBalanceSheetPageData,
} from "@/app/dashboard/finance/balance-sheet-page-data";
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
  businessUnitId: string | null;
  businessUnitName: string;
};

export type BalanceSheetIntegrityScopeResult = {
  scope: "tenant" | "business_unit";
  businessUnitId: string | null;
  businessUnitName: string;
  imbalances: BalanceSheetMonthImbalance[];
  maxAbsDiff: number;
};

export type TenantBalanceSheetIntegrityResult = {
  tenantId: string;
  tenantName: string;
  fiscalYear: number;
  monthsChecked: number[];
  /** Flat list across tenant-wide + each business unit (for alerts / metadata). */
  imbalances: BalanceSheetMonthImbalance[];
  scopeResults: BalanceSheetIntegrityScopeResult[];
  maxAbsDiff: number;
  orphanApAccrualCount: number;
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
  orphanApAccrualCount = 0,
): SystemEventStatus {
  if (imbalances.length === 0) {
    return orphanApAccrualCount > 0 ? "warning" : "success";
  }

  const maxAbsDiff = Math.max(...imbalances.map((row) => Math.abs(row.diff)));
  if (maxAbsDiff >= BS_INTEGRITY_FAILURE_THRESHOLD) {
    return "failure";
  }

  if (maxAbsDiff > BALANCE_TOLERANCE || orphanApAccrualCount > 0) {
    return "warning";
  }

  return "success";
}

export async function countTenantOrphanApAccrualExpenses(
  admin: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { data, error } = await admin.rpc("count_tenant_orphan_ap_accrual_expenses", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return Number(data ?? 0);
}

type BusinessUnitRow = { id: string; name: string };

async function loadTenantBusinessUnits(
  admin: SupabaseClient,
  tenantId: string,
): Promise<BusinessUnitRow[]> {
  const { data, error } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("name");

  if (error) {
    throw new Error(`Failed to load business units: ${error.message}`);
  }

  return (data ?? []) as BusinessUnitRow[];
}

function auditReportForScope(
  data: Awaited<ReturnType<typeof fetchBalanceSheetPageData>>,
  tenantId: string,
  fiscalYear: number,
  monthsChecked: number[],
  businessUnitId: string | null,
  businessUnitName: string,
  scope: "tenant" | "business_unit",
): BalanceSheetIntegrityScopeResult {
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
    data.initialWelfareFundEntries,
    {
      tenantId,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
      directorsLoanLedgerEntries: data.initialDirectorsLoanLedgerEntries,
      ...buildCustomerCreditsBalanceSheetOptions(data),
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
        businessUnitId,
        businessUnitName,
      });
    }
  }

  const maxAbsDiff =
    imbalances.length > 0
      ? Math.max(...imbalances.map((row) => Math.abs(row.diff)))
      : 0;

  return {
    scope,
    businessUnitId,
    businessUnitName,
    imbalances,
    maxAbsDiff: roundCurrency(maxAbsDiff),
  };
}

export async function auditTenantBalanceSheetIntegrity(
  admin: SupabaseClient,
  tenant: { id: string; name: string },
  fiscalYear: number,
  referenceDate = new Date(),
): Promise<TenantBalanceSheetIntegrityResult> {
  const startedAt = Date.now();
  const monthsChecked = resolveClosedMonthIndices(fiscalYear, referenceDate);

  let businessUnits: BusinessUnitRow[] = [];
  try {
    businessUnits = await loadTenantBusinessUnits(admin, tenant.id);
  } catch (error) {
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      fiscalYear,
      monthsChecked,
      imbalances: [],
      scopeResults: [],
      maxAbsDiff: 0,
      orphanApAccrualCount: 0,
      status: "failure",
      fetchError: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }

  const scopeResults: BalanceSheetIntegrityScopeResult[] = [];

  const tenantWideData = await fetchBalanceSheetPageData(admin, tenant.id, {
    dateRange: null,
    viewAllBusinessUnits: true,
  });
  if (tenantWideData.fetchError) {
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      fiscalYear,
      monthsChecked,
      imbalances: [],
      scopeResults: [],
      maxAbsDiff: 0,
      orphanApAccrualCount: 0,
      status: "failure",
      fetchError: tenantWideData.fetchError,
      durationMs: Date.now() - startedAt,
    };
  }

  scopeResults.push(
    auditReportForScope(
      tenantWideData,
      tenant.id,
      fiscalYear,
      monthsChecked,
      null,
      "All businesses",
      "tenant",
    ),
  );

  for (const unit of businessUnits) {
    const unitData = await fetchBalanceSheetPageData(admin, tenant.id, {
      dateRange: null,
      viewAllBusinessUnits: false,
      activeBusinessUnitId: unit.id,
    });
    if (unitData.fetchError) {
      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        fiscalYear,
        monthsChecked,
        imbalances: [],
        scopeResults,
        maxAbsDiff: 0,
        orphanApAccrualCount: 0,
        status: "failure",
        fetchError: unitData.fetchError,
        durationMs: Date.now() - startedAt,
      };
    }

    scopeResults.push(
      auditReportForScope(
        unitData,
        tenant.id,
        fiscalYear,
        monthsChecked,
        unit.id,
        unit.name,
        "business_unit",
      ),
    );
  }

  const imbalances = scopeResults.flatMap((row) => row.imbalances);
  const maxAbsDiff =
    imbalances.length > 0
      ? Math.max(...imbalances.map((row) => Math.abs(row.diff)))
      : 0;

  let orphanApAccrualCount = 0;
  try {
    orphanApAccrualCount = await countTenantOrphanApAccrualExpenses(admin, tenant.id);
  } catch (error) {
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      fiscalYear,
      monthsChecked,
      imbalances,
      scopeResults,
      maxAbsDiff: roundCurrency(maxAbsDiff),
      orphanApAccrualCount: 0,
      status: "failure",
      fetchError: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    fiscalYear,
    monthsChecked,
    imbalances,
    scopeResults,
    maxAbsDiff: roundCurrency(maxAbsDiff),
    orphanApAccrualCount,
    status: classifyBalanceSheetIntegrityStatus(imbalances, orphanApAccrualCount),
    fetchError: null,
    durationMs: Date.now() - startedAt,
  };
}
