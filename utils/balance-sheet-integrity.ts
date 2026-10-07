import { BS_INTEGRITY_FAILURE_THRESHOLD } from "@/utils/balance-sheet-integrity-constants";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BALANCE_CHECK_ROUNDING_TOLERANCE,
  BALANCE_TOLERANCE,
} from "@/app/dashboard/finance/balance-sheet-utils";
import { fetchBalanceSheetPageData } from "@/app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
  type StandardBalanceSheetReportExtras,
} from "@/lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "@/app/dashboard/finance/balance-sheet-utils";
import type { BalanceSheetPageData } from "@/app/dashboard/finance/balance-sheet-page-data";
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
  zeroCogsProductSaleLines: number;
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
  zeroCogsProductSaleLines = 0,
): SystemEventStatus {
  if (imbalances.length === 0) {
    return orphanApAccrualCount > 0 || zeroCogsProductSaleLines > 0
      ? "warning"
      : "success";
  }

  const maxAbsDiff = Math.max(...imbalances.map((row) => Math.abs(row.diff)));
  if (maxAbsDiff >= BS_INTEGRITY_FAILURE_THRESHOLD) {
    return "failure";
  }

  if (
    maxAbsDiff >= BALANCE_CHECK_ROUNDING_TOLERANCE ||
    orphanApAccrualCount > 0 ||
    zeroCogsProductSaleLines > 0
  ) {
    return "warning";
  }

  return "success";
}

export async function countTenantZeroCogsProductSales(
  admin: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { data, error: rowsError } = await admin
    .from("income_register")
    .select("id, sale_quantity, cogs_expense_id")
    .eq("tenant_id", tenantId)
    .eq("entry_type", "product_sale")
    .neq("sale_status", "voided")
    .gt("sale_quantity", 0);

  if (rowsError) {
    throw new Error(rowsError.message);
  }

  const expenseIds = [
    ...new Set(
      (data ?? [])
        .map((row) => row.cogs_expense_id)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const amounts = new Map<string, number>();
  if (expenseIds.length > 0) {
    const { data: expenses, error: expError } = await admin
      .from("expense_register")
      .select("id, amount")
      .in("id", expenseIds);
    if (expError) {
      throw new Error(expError.message);
    }
    for (const row of expenses ?? []) {
      amounts.set(String(row.id), Number(row.amount) || 0);
    }
  }

  let zeroLines = 0;
  for (const row of data ?? []) {
    if (!row.cogs_expense_id) {
      zeroLines += 1;
      continue;
    }
    if (Math.abs(amounts.get(String(row.cogs_expense_id)) ?? 0) < 0.0001) {
      zeroLines += 1;
    }
  }
  return zeroLines;
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

function standardReportExtrasForPageData(
  data: BalanceSheetPageData,
  viewAllBusinessUnits: boolean,
): StandardBalanceSheetReportExtras {
  return viewAllBusinessUnits
    ? {
        allBusinessUnitsDirectorsLoan: true,
        rawManualFinancialEntries: data.initialRawManualEntries,
      }
    : {};
}

function auditReportForScope(
  data: BalanceSheetPageData,
  tenantId: string,
  fiscalYear: number,
  monthsChecked: number[],
  businessUnitId: string | null,
  businessUnitName: string,
  scope: "tenant" | "business_unit",
  reportExtras: StandardBalanceSheetReportExtras = {},
): BalanceSheetIntegrityScopeResult {
  const report = buildStandardBalanceSheetReport(
    data,
    tenantId,
    fiscalYear,
    reportExtras,
  );

  const imbalances: BalanceSheetMonthImbalance[] = [];
  for (const monthIndex of monthsChecked) {
    const check = getBalanceSheetMonthCheck(report, monthIndex);
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

const AGGREGATION_PARITY_SCOPE_NAME =
  "Aggregation (All ≠ BUs + Untagged)" as const;

/**
 * Assert All businesses line amounts equal the sum of each named BU plus Untagged
 * (NULL business_unit_id bucket) for every balance sheet row and checked month.
 */
export function auditBalanceSheetScopeAggregationParity(
  allData: BalanceSheetPageData,
  untaggedData: BalanceSheetPageData,
  unitDataList: Array<{ businessUnitId: string; businessUnitName: string; data: BalanceSheetPageData }>,
  tenantId: string,
  fiscalYear: number,
  monthsChecked: number[],
): BalanceSheetMonthImbalance[] {
  const allReport = buildStandardBalanceSheetReport(
    allData,
    tenantId,
    fiscalYear,
    standardReportExtrasForPageData(allData, true),
  );
  const untaggedReport = buildStandardBalanceSheetReport(
    untaggedData,
    tenantId,
    fiscalYear,
  );
  const unitReports = unitDataList.map((row) => ({
    ...row,
    report: buildStandardBalanceSheetReport(row.data, tenantId, fiscalYear),
  }));

  const lineKeys = allReport.rows
    .filter((row) => row.kind !== "section")
    .map((row) => row.key);

  const imbalances: BalanceSheetMonthImbalance[] = [];

  for (const monthIndex of monthsChecked) {
    let worstLineDiff = 0;
    for (const key of lineKeys) {
      const allRow = allReport.rows.find((row) => row.key === key);
      if (!allRow || allRow.kind === "section") {
        continue;
      }
      const allAmount = getBalanceSheetAmountForMonth(allRow, monthIndex);
      const untaggedRow = untaggedReport.rows.find((row) => row.key === key);
      let summed = untaggedRow
        ? getBalanceSheetAmountForMonth(untaggedRow, monthIndex)
        : 0;
      for (const unit of unitReports) {
        const unitRow = unit.report.rows.find((row) => row.key === key);
        if (unitRow) {
          summed = roundCurrency(
            summed + getBalanceSheetAmountForMonth(unitRow, monthIndex),
          );
        }
      }
      const lineDiff = roundCurrency(allAmount - summed);
      if (Math.abs(lineDiff) > BALANCE_TOLERANCE) {
        worstLineDiff = roundCurrency(
          Math.max(Math.abs(worstLineDiff), Math.abs(lineDiff)),
        );
      }
    }
    if (Math.abs(worstLineDiff) > BALANCE_TOLERANCE) {
      const monthCheck = getBalanceSheetMonthCheck(allReport, monthIndex);
      imbalances.push({
        monthIndex,
        monthLabel: `${MONTH_LABELS[monthIndex]} ${fiscalYear} (scope sum)`,
        diff: roundCurrency(worstLineDiff),
        totalAssets: roundCurrency(monthCheck.totalAssets),
        totalLiabilitiesAndEquity: roundCurrency(
          monthCheck.totalLiabilitiesAndEquity,
        ),
        businessUnitId: null,
        businessUnitName: AGGREGATION_PARITY_SCOPE_NAME,
      });
    }
  }

  return imbalances;
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
      zeroCogsProductSaleLines: 0,
      status: "failure",
      fetchError: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }

  const scopeResults: BalanceSheetIntegrityScopeResult[] = [];

  const tenantWideData = await fetchBalanceSheetPageData(admin, tenant.id, {
    dateRange: null,
    viewAllBusinessUnits: true,
    referenceDate,
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
      zeroCogsProductSaleLines: 0,
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
      standardReportExtrasForPageData(tenantWideData, true),
    ),
  );

  const untaggedData = await fetchBalanceSheetPageData(admin, tenant.id, {
    dateRange: null,
    viewAllBusinessUnits: false,
    activeBusinessUnitId: null,
    referenceDate,
  });
  if (untaggedData.fetchError) {
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      fiscalYear,
      monthsChecked,
      imbalances: [],
      scopeResults,
      maxAbsDiff: 0,
      orphanApAccrualCount: 0,
      zeroCogsProductSaleLines: 0,
      status: "failure",
      fetchError: untaggedData.fetchError,
      durationMs: Date.now() - startedAt,
    };
  }

  const unitDataList: Array<{
    businessUnitId: string;
    businessUnitName: string;
    data: BalanceSheetPageData;
  }> = [];

  for (const unit of businessUnits) {
    const unitData = await fetchBalanceSheetPageData(admin, tenant.id, {
      dateRange: null,
      viewAllBusinessUnits: false,
      activeBusinessUnitId: unit.id,
      referenceDate,
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
        zeroCogsProductSaleLines: 0,
        status: "failure",
        fetchError: unitData.fetchError,
        durationMs: Date.now() - startedAt,
      };
    }

    unitDataList.push({
      businessUnitId: unit.id,
      businessUnitName: unit.name,
      data: unitData,
    });

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

  const aggregationImbalances = auditBalanceSheetScopeAggregationParity(
    tenantWideData,
    untaggedData,
    unitDataList,
    tenant.id,
    fiscalYear,
    monthsChecked,
  );

  if (aggregationImbalances.length > 0) {
    scopeResults.push({
      scope: "tenant",
      businessUnitId: null,
      businessUnitName: AGGREGATION_PARITY_SCOPE_NAME,
      imbalances: aggregationImbalances,
      maxAbsDiff: roundCurrency(
        Math.max(...aggregationImbalances.map((row) => Math.abs(row.diff))),
      ),
    });
  }

  const imbalances = scopeResults.flatMap((row) => row.imbalances);
  const maxAbsDiff =
    imbalances.length > 0
      ? Math.max(...imbalances.map((row) => Math.abs(row.diff)))
      : 0;

  let orphanApAccrualCount = 0;
  let zeroCogsProductSaleLines = 0;
  try {
    [orphanApAccrualCount, zeroCogsProductSaleLines] = await Promise.all([
      countTenantOrphanApAccrualExpenses(admin, tenant.id),
      countTenantZeroCogsProductSales(admin, tenant.id),
    ]);
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
      zeroCogsProductSaleLines: 0,
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
    zeroCogsProductSaleLines,
    status: classifyBalanceSheetIntegrityStatus(
      imbalances,
      orphanApAccrualCount,
      zeroCogsProductSaleLines,
    ),
    fetchError: null,
    durationMs: Date.now() - startedAt,
  };
}
