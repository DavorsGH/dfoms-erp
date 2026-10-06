import { getMonthEndDate } from "../../app/dashboard/finance/capital-contributions-utils";
import { calculateManualLiabilityStockByMonth } from "../../app/dashboard/finance/balance-sheet-utils";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  type BalanceSheetReport,
} from "../../app/dashboard/finance/balance-sheet-utils";
import {
  buildCashFlowReport,
  filterManualEntriesForYear,
  type CashFlowReport,
} from "../../app/dashboard/finance/cash-flow-utils";
import {
  buildProfitLossReport,
  FULL_YEAR_INDEX,
  type ProfitLossReport,
} from "../../app/dashboard/finance/profit-loss-utils";
import { buildNetPayByPayrollMonth } from "../../app/dashboard/finance/accrued-wages-utils";
import type { BalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  aggregateManualEntriesByPeriodMonth,
  type ManualFinancialEntryRecord,
} from "../../app/dashboard/finance/manual-financial-entries-utils";
import type { ManualFinancialEntry } from "../../app/dashboard/finance/cash-flow-utils";
import type { CashMovementManualEntry } from "../../app/dashboard/finance/cash-movement-utils";
import {
  DIRECTORS_LOAN_NON_CASH_REFERENCE_PREFIX,
  type DirectorsLoanLedgerEntry,
  type DirectorsLoanLedgerEntryType,
} from "../../app/dashboard/finance/directors-loan-ledger-utils";

export const PARITY_FY = 2026;
export const TOLERANCE = 0.01;

export type PlannedLedgerInsert = {
  tenant_id: string;
  business_unit_id: string | null;
  entry_date: string;
  entry_type: DirectorsLoanLedgerEntryType;
  amount: number;
  description: string;
  reference: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthIndexFromDate(iso: string, fy: number): number | null {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  if (y !== fy || m < 1 || m > 12) return null;
  return m - 1;
}

export function planLedgerInserts(
  tenantId: string,
  manuals: ManualFinancialEntryRecord[],
  repayments: Array<{
    repayment_date: string;
    amount: number;
    business_unit_id?: string | null;
  }>,
  existingLedger: DirectorsLoanLedgerEntry[],
): PlannedLedgerInsert[] {
  const migratedRefs = new Set(
    existingLedger
      .filter((e) => (e.reference ?? "").startsWith("migrated"))
      .map((e) => `${e.entry_type}:${e.entry_date}:${e.amount}`),
  );
  const planned: PlannedLedgerInsert[] = [];

  const buIds = new Set<string | null>();
  for (const row of manuals) {
    buIds.add(row.business_unit_id ?? null);
  }

  for (const buId of buIds) {
    const manualRows = manuals.filter((r) => (r.business_unit_id ?? null) === buId);
    const years = new Set<number>();
    for (const row of manualRows) {
      const y = Number(String(row.period_month).slice(0, 4));
      if (y > 2000) years.add(y);
    }
    for (const year of years) {
      const cashEntries = manualRows.map((r) => ({
        period_month: r.period_month,
        directors_loan: r.directors_loan,
        loan_proceeds: r.loan_proceeds,
        loan_repayments: r.loan_repayments,
      }));
      let prev = 0;
      for (let month = 1; month <= 12; month += 1) {
        const stock = calculateManualLiabilityStockByMonth(
          cashEntries,
          "directors_loan",
          year,
        )[month - 1];
        const delta = round2(stock - prev);
        if (delta > 0.005) {
          const period = `${year}-${String(month).padStart(2, "0")}-01`;
          const row = manualRows.find(
            (r) => r.period_month?.slice(0, 7) === period.slice(0, 7),
          );
          const entry_date = getMonthEndDate(year, month);
          const payload: PlannedLedgerInsert = {
            tenant_id: tenantId,
            business_unit_id: buId,
            entry_date,
            entry_type: "director_lent_company",
            amount: delta,
            description: "Migrated from monthly entry",
            reference: "migrated",
          };
          const key = `${payload.entry_type}:${payload.entry_date}:${payload.amount}`;
          if (!migratedRefs.has(key)) {
            planned.push(payload);
          }
        }
        prev = stock;
      }
    }
  }

  for (const rep of repayments) {
    const entry_date = String(rep.repayment_date).slice(0, 10);
    const amount = round2(Number(rep.amount));
    const payload: PlannedLedgerInsert = {
      tenant_id: tenantId,
      business_unit_id: rep.business_unit_id ?? null,
      entry_date,
      entry_type: "company_repaid_director",
      amount,
      description: "Migrated from monthly entry",
      reference: "migrated-repayment",
    };
    const key = `${payload.entry_type}:${payload.entry_date}:${payload.amount}`;
    if (!migratedRefs.has(key)) {
      planned.push(payload);
    }
  }

  return planned;
}

export function simulateLedgerEntries(
  planned: PlannedLedgerInsert[],
): DirectorsLoanLedgerEntry[] {
  return planned.map((p, index) => ({
    id: `sim-${index}`,
    tenant_id: p.tenant_id,
    business_unit_id: p.business_unit_id,
    entry_date: p.entry_date,
    entry_type: p.entry_type,
    amount: p.amount,
    description: p.description,
    reference: p.reference,
    notes: null,
    linked_expense_id: null,
    reversed_at: null,
    reversed_by: null,
    reversal_reason: null,
    created_at: new Date().toISOString(),
    created_by: null,
  }));
}

export type ManualMigrationPatchPreview = {
  tenant_id: string;
  period_month: string;
  business_unit_id: string | null;
  before: {
    directors_loan: number;
    loan_proceeds: number;
    loan_repayments: number;
  };
  after: {
    directors_loan: number;
    loan_proceeds: number;
    loan_repayments: number;
  };
};

/**
 * After director's-loan amounts are migrated into directors_loan_entries, zero the
 * manual directors_loan stock column and migrated repayment flows only.
 * Never alters loan_proceeds (bank loans and director proceeds share that field).
 */
export function patchManualEntriesForLedger(
  manuals: ManualFinancialEntry[],
  planned: PlannedLedgerInsert[],
  fy: number,
): ManualFinancialEntry[] {
  if (planned.length === 0) {
    return manuals;
  }

  const repaidByBuMonth = new Map<string, number>();
  for (const row of planned) {
    if (row.entry_type !== "company_repaid_director") continue;
    const y = Number(row.entry_date.slice(0, 4));
    if (y !== fy) continue;
    const mi = monthIndexFromDate(row.entry_date, fy);
    if (mi === null) continue;
    const buKey = row.business_unit_id ?? "null";
    const key = `${buKey}:${mi}`;
    repaidByBuMonth.set(
      key,
      round2((repaidByBuMonth.get(key) ?? 0) + (Number(row.amount) || 0)),
    );
  }

  return manuals.map((row) => {
    const y = Number(String(row.period_month).slice(0, 4));
    if (y !== fy) return row;
    const mi = monthIndexFromDate(String(row.period_month).slice(0, 10), fy);
    if (mi === null) return row;
    const buKey =
      (row as { business_unit_id?: string | null }).business_unit_id ?? "null";
    const key = `${buKey}:${mi}`;
    const migratedRepaid = repaidByBuMonth.get(key) ?? 0;
    const loanRepayments = Number(row.loan_repayments) || 0;
    const loanProceeds = Number(row.loan_proceeds) || 0;
    const directorsLoan = Number(row.directors_loan) || 0;
    if (directorsLoan === 0 && migratedRepaid === 0) {
      return row;
    }
    return {
      ...row,
      directors_loan: 0,
      loan_proceeds,
      loan_repayments:
        migratedRepaid > 0
          ? round2(Math.max(0, loanRepayments - migratedRepaid))
          : loanRepayments,
    };
  }) as ManualFinancialEntry[];
}

export function previewManualMigrationPatches(
  tenantId: string,
  manuals: ManualFinancialEntryRecord[],
  planned: PlannedLedgerInsert[],
  fy: number,
): ManualMigrationPatchPreview[] {
  const beforeByKey = new Map<string, ManualFinancialEntryRecord>();
  for (const row of manuals) {
    const y = Number(String(row.period_month).slice(0, 4));
    if (y !== fy) continue;
    const bu = row.business_unit_id ?? null;
    beforeByKey.set(`${bu ?? "null"}:${row.period_month}`, row);
  }

  const patched = patchManualEntriesForLedger(
    manuals as ManualFinancialEntry[],
    planned,
    fy,
  ) as ManualFinancialEntryRecord[];

  const previews: ManualMigrationPatchPreview[] = [];
  for (const after of patched) {
    const y = Number(String(after.period_month).slice(0, 4));
    if (y !== fy) continue;
    const bu = after.business_unit_id ?? null;
    const before = beforeByKey.get(`${bu ?? "null"}:${after.period_month}`);
    if (!before) continue;
    const beforeLoan = Number(before.directors_loan) || 0;
    const beforeProceeds = Number(before.loan_proceeds) || 0;
    const beforeRepay = Number(before.loan_repayments) || 0;
    const afterLoan = Number(after.directors_loan) || 0;
    const afterProceeds = Number(after.loan_proceeds) || 0;
    const afterRepay = Number(after.loan_repayments) || 0;
    if (
      beforeLoan === afterLoan &&
      beforeProceeds === afterProceeds &&
      beforeRepay === afterRepay
    ) {
      continue;
    }
    previews.push({
      tenant_id: tenantId,
      period_month: after.period_month,
      business_unit_id: bu,
      before: {
        directors_loan: beforeLoan,
        loan_proceeds: beforeProceeds,
        loan_repayments: beforeRepay,
      },
      after: {
        directors_loan: afterLoan,
        loan_proceeds: afterProceeds,
        loan_repayments: afterRepay,
      },
    });
  }
  return previews;
}

export function normalizeMigratedLedgerReference(
  reference: string | null,
): string | null {
  const ref = (reference ?? "").trim();
  if (!ref.toLowerCase().startsWith(DIRECTORS_LOAN_NON_CASH_REFERENCE_PREFIX)) {
    return reference;
  }
  const rest = ref.slice(DIRECTORS_LOAN_NON_CASH_REFERENCE_PREFIX.length).trim();
  if (rest.startsWith("migrated")) return rest || "migrated";
  return "migrated";
}

function resolveManualEntries(
  data: BalanceSheetPageData,
  buMode: "all" | "default" | "unit",
): ManualFinancialEntry[] {
  const raw = data.initialManualEntries as ManualFinancialEntryRecord[];
  if (buMode === "all") {
    return aggregateManualEntriesByPeriodMonth(raw) as ManualFinancialEntry[];
  }
  return raw as ManualFinancialEntry[];
}

export type ReportBundle = {
  balanceSheet: BalanceSheetReport;
  cashFlow: CashFlowReport;
  profitLoss: ProfitLossReport;
};

export function filterLedgerByScope(
  entries: DirectorsLoanLedgerEntry[],
  buMode: "all" | "default" | "unit",
  unitId?: string | null,
): DirectorsLoanLedgerEntry[] {
  if (buMode === "all") return entries;
  if (buMode === "default") {
    return entries.filter((e) => (e.business_unit_id ?? null) === null);
  }
  return entries.filter((e) => e.business_unit_id === unitId);
}

export function buildReportBundle(
  data: BalanceSheetPageData,
  buMode: "all" | "default" | "unit",
  fy: number,
  ledgerEntries: DirectorsLoanLedgerEntry[],
  manualOverride?: ManualFinancialEntry[],
  unitId?: string | null,
): ReportBundle {
  const scopedLedger = filterLedgerByScope(ledgerEntries, buMode, unitId);
  let manual = manualOverride ?? resolveManualEntries(data, buMode);
  if (buMode === "all") {
    manual = aggregateManualEntriesByPeriodMonth(
      (manualOverride ?? data.initialManualEntries) as ManualFinancialEntryRecord[],
    ) as ManualFinancialEntry[];
  }
  const manualForYear = filterManualEntriesForYear(manual, fy);
  const staffSalaryNetByPayrollMonth = buildNetPayByPayrollMonth(
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
  );

  const reportOptions = {
    tenantId: data.tenantId,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    directorsLoanLedgerEntries: scopedLedger,
    allBusinessUnitsDirectorsLoan: buMode === "all",
    rawManualFinancialEntries:
      buMode === "all"
        ? (data.initialRawManualEntries as CashMovementManualEntry[])
        : undefined,
  };

  const balanceSheet = buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    fy,
    data.initialInventoryBalanceSheet,
    manualForYear,
    data.initialTaxLedgerEntries,
    data.initialWelfareFundEntries,
    reportOptions,
  );

  const cashFlow = buildCashFlowReport(
    data.initialCashFlowIncomeEntries,
    data.initialCashFlowExpenseEntries,
    manualForYear,
    fy,
    {
      rawMaterialCashPurchases:
        data.initialInventoryBalanceSheet.cashPurchases ?? [],
      productCashPurchases:
        data.initialInventoryBalanceSheet.productCashPurchases ?? [],
      inventoryConfig: data.initialInventoryBalanceSheet.config,
    },
    data.initialFixedAssets,
    data.initialCapitalContributions,
    staffSalaryNetByPayrollMonth,
    data.initialPayableEntries,
    reportOptions,
  );

  const profitLoss = buildProfitLossReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    fy,
  );

  return { balanceSheet, cashFlow, profitLoss };
}

export type ParityDiff = {
  tenant: string;
  scope: string;
  month: number;
  report: "BS" | "CF" | "PL";
  key: string;
  label: string;
  oldValue: number;
  newValue: number;
  delta: number;
};

function compareAmounts(
  oldAmounts: number[],
  newAmounts: number[],
  fy: number,
  meta: Omit<ParityDiff, "month" | "oldValue" | "newValue" | "delta">,
  diffs: ParityDiff[],
) {
  for (let month = 0; month < 12; month += 1) {
    const oldValue = round2(oldAmounts[month] ?? 0);
    const newValue = round2(newAmounts[month] ?? 0);
    const delta = round2(newValue - oldValue);
    if (Math.abs(delta) > TOLERANCE) {
      diffs.push({
        ...meta,
        month: month + 1,
        oldValue,
        newValue,
        delta,
      });
    }
  }
}

export function compareReportBundles(
  tenant: string,
  scope: string,
  oldBundle: ReportBundle,
  newBundle: ReportBundle,
): ParityDiff[] {
  const diffs: ParityDiff[] = [];

  for (const row of oldBundle.balanceSheet.rows) {
    if (row.kind === "section") continue;
    const newRow = newBundle.balanceSheet.rows.find((r) => r.key === row.key);
    if (!newRow) {
      diffs.push({
        tenant,
        scope,
        month: 0,
        report: "BS",
        key: row.key,
        label: row.label,
        oldValue: 1,
        newValue: 0,
        delta: 1,
      });
      continue;
    }
    compareAmounts(row.amounts, newRow.amounts, PARITY_FY, {
      tenant,
      scope,
      report: "BS",
      key: row.key,
      label: row.label,
    }, diffs);
  }

  const cfRowAmounts = (bundle: ReportBundle, key: string): number[] => {
    const row = bundle.cashFlow.rows.find((r) => r.key === key);
    return row?.amounts ?? Array(13).fill(0);
  };
  const combinedLoanProceeds = (bundle: ReportBundle): number[] => {
    const base = cfRowAmounts(bundle, "loan-proceeds");
    const dlIn = cfRowAmounts(bundle, "directors-loan-inflows");
    return base.map((v, i) => round2(v + (dlIn[i] ?? 0)));
  };
  const cfKeysSkip = new Set(["directors-loan-inflows"]);

  for (const row of oldBundle.cashFlow.rows) {
    if (row.kind === "section") continue;
    if (cfKeysSkip.has(row.key)) continue;
    let newAmounts: number[];
    if (row.key === "loan-proceeds") {
      newAmounts = combinedLoanProceeds(newBundle);
    } else {
      const newRow2 = newBundle.cashFlow.rows.find((r) => r.key === row.key);
      if (!newRow2) continue;
      newAmounts = newRow2.amounts;
    }
    compareAmounts(row.amounts, newAmounts, PARITY_FY, {
      tenant,
      scope,
      report: "CF",
      key: row.key,
      label: row.label,
    }, diffs);
  }

  const oldPl = oldBundle.profitLoss.rows.find((r) => r.key === "net-profit");
  const newPl = newBundle.profitLoss.rows.find((r) => r.key === "net-profit");
  if (oldPl && newPl) {
    compareAmounts(oldPl.amounts, newPl.amounts, PARITY_FY, {
      tenant,
      scope,
      report: "PL",
      key: "net-profit",
      label: "Net Profit",
    }, diffs);
  }

  for (let month = 0; month < 12; month += 1) {
    const oldCheck = getBalanceCheckForPeriod(oldBundle.balanceSheet, month);
    const newCheck = getBalanceCheckForPeriod(newBundle.balanceSheet, month);
    if (Math.abs(oldCheck.difference - newCheck.difference) > TOLERANCE) {
      diffs.push({
        tenant,
        scope,
        month: month + 1,
        report: "BS",
        key: "balance-check-diff",
        label: "BS balance check difference",
        oldValue: oldCheck.difference,
        newValue: newCheck.difference,
        delta: round2(newCheck.difference - oldCheck.difference),
      });
    }
  }

  return diffs;
}

export function snapshotOldPath(
  bundle: ReportBundle,
): Record<string, number[]> {
  return snapshotNewPath(bundle);
}

export function snapshotNewPath(
  bundle: ReportBundle,
): Record<string, number[]> {
  const snap: Record<string, number[]> = {};
  for (const row of bundle.balanceSheet.rows) {
    if (row.kind === "section") continue;
    snap[`BS:${row.key}`] = row.amounts.slice(0, 12);
  }
  for (const row of bundle.cashFlow.rows) {
    if (row.kind === "section") continue;
    snap[`CF:${row.key}`] = row.amounts.slice(0, 12);
  }
  const pl = bundle.profitLoss.rows.find((r) => r.key === "net-profit");
  if (pl) snap["PL:net-profit"] = pl.amounts.slice(0, 12);
  return snap;
}

export function compareSnapshots(
  a: Record<string, number[]>,
  b: Record<string, number[]>,
): ParityDiff[] {
  const diffs: ParityDiff[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key] ?? Array(12).fill(0);
    const right = b[key] ?? Array(12).fill(0);
    for (let m = 0; m < 12; m += 1) {
      const delta = round2((right[m] ?? 0) - (left[m] ?? 0));
      if (Math.abs(delta) > TOLERANCE) {
        diffs.push({
          tenant: "",
          scope: "",
          month: m + 1,
          report: key.startsWith("PL") ? "PL" : key.startsWith("CF") ? "CF" : "BS",
          key,
          label: key,
          oldValue: left[m] ?? 0,
          newValue: right[m] ?? 0,
          delta,
        });
      }
    }
  }
  return diffs;
}
