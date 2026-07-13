"use client";

import { useMemo, useState } from "react";
import { getDefaultSelectedYear } from "./finance-year-utils";
import FinancialYearSelector from "./financial-year-selector";
import { formatGHS } from "./income-register-utils";
import {
  FULL_YEAR_INDEX,
  MONTH_LABELS,
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  type BalanceSheetAccountsPayableEntry,
  type BalanceSheetIncomeEntry,
  type BalanceSheetRow,
} from "./balance-sheet-utils";
import type { CapitalContributionEntry } from "./capital-contributions-utils";
import type {
  CashFlowExpenseEntry,
  CashFlowIncomeEntry,
  ManualFinancialEntry,
} from "./cash-flow-utils";
import type {
  ProfitLossAssetEntry,
  ProfitLossExpenseEntry,
  ProfitLossIncomeEntry,
} from "./profit-loss-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

type BalanceSheetProps = {
  initialIncomeEntries: BalanceSheetIncomeEntry[];
  initialExpenseEntries: ProfitLossExpenseEntry[];
  initialFixedAssets: ProfitLossAssetEntry[];
  initialPayableEntries: BalanceSheetAccountsPayableEntry[];
  initialCapitalContributions: CapitalContributionEntry[];
  initialCashFlowIncomeEntries: CashFlowIncomeEntry[];
  initialCashFlowExpenseEntries: CashFlowExpenseEntry[];
  initialManualEntries: ManualFinancialEntry[];
  availableYears: number[];
  fetchError: string | null;
};

const fullYearHeaderClassName =
  "sticky top-0 z-10 bg-slate-200 px-4 py-3 font-semibold text-[#0f2744]";

const fullYearCellClassName =
  "bg-slate-100 px-4 py-3 font-semibold text-[#0f2744]";

function getRowClassName(row: BalanceSheetRow, index: number): string {
  if (row.kind === "section") {
    return "bg-[#0f2744] text-sm font-semibold uppercase tracking-wide text-white";
  }

  if (row.kind === "subtotal" || row.kind === "total") {
    return "bg-slate-50 text-sm font-semibold text-[#0f2744]";
  }

  return index % 2 === 1 ? "bg-slate-50 text-slate-700" : "text-slate-700";
}

function BalanceCheckSummary({
  totalAssets,
  totalLiabilitiesAndEquity,
  difference,
  isBalanced,
  periodLabel,
}: {
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  difference: number;
  isBalanced: boolean;
  periodLabel: string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
        Balance Check
      </h3>
      <p className="mb-4 text-sm text-slate-600">
        Comparing totals as at {periodLabel}, calculated live from registers and
        contributions.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-600">Total Assets</p>
          <p className="text-lg font-semibold text-[#0f2744]">
            {formatGHS(totalAssets)}
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-600">Total Liabilities + Equity</p>
          <p className="text-lg font-semibold text-[#0f2744]">
            {formatGHS(totalLiabilitiesAndEquity)}
          </p>
        </div>
      </div>
      <p
        className={`mt-4 rounded-md px-4 py-3 text-sm font-medium ${
          isBalanced
            ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border border-red-200 bg-red-50 text-red-800"
        }`}
      >
        {isBalanced
          ? "✅ Balanced"
          : `❌ Out of balance by ${formatGHS(Math.abs(difference))}`}
      </p>
    </section>
  );
}

export default function BalanceSheet({
  initialIncomeEntries,
  initialExpenseEntries,
  initialFixedAssets,
  initialPayableEntries,
  initialCapitalContributions,
  initialCashFlowIncomeEntries,
  initialCashFlowExpenseEntries,
  initialManualEntries,
  availableYears,
  fetchError,
}: BalanceSheetProps) {
  const [selectedYear, setSelectedYear] = useState(() =>
    getDefaultSelectedYear(availableYears),
  );

  const report = useMemo(
    () =>
      buildBalanceSheetReport(
        initialIncomeEntries,
        initialExpenseEntries,
        initialFixedAssets,
        initialPayableEntries,
        initialCapitalContributions,
        initialCashFlowIncomeEntries,
        initialCashFlowExpenseEntries,
        initialManualEntries,
        selectedYear,
      ),
    [
      initialIncomeEntries,
      initialExpenseEntries,
      initialFixedAssets,
      initialPayableEntries,
      initialCapitalContributions,
      initialCashFlowIncomeEntries,
      initialCashFlowExpenseEntries,
      initialManualEntries,
      selectedYear,
    ],
  );

  const balanceCheck = useMemo(
    () => getBalanceCheckForPeriod(report, FULL_YEAR_INDEX),
    [report],
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-slate-600">
          Monthly balance sheet for financial year {report.financialYear},
          calculated live from cash, receivables, fixed assets, payables, and
          equity.
        </p>
        <FinancialYearSelector
          years={availableYears}
          selectedYear={selectedYear}
          onChange={setSelectedYear}
        />
      </div>

      {fetchError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      )}

      <BalanceCheckSummary
        totalAssets={balanceCheck.totalAssets}
        totalLiabilitiesAndEquity={balanceCheck.totalLiabilitiesAndEquity}
        difference={balanceCheck.difference}
        isBalanced={balanceCheck.isBalanced}
        periodLabel={`31 Dec ${report.financialYear}`}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Line Item</th>
              {MONTH_LABELS.map((month) => (
                <th key={month} className={scrollableTableThClassName}>
                  {month} {report.financialYear}
                </th>
              ))}
              <th className={fullYearHeaderClassName}>Full Year</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {report.rows.map((row, index) => (
              <tr key={row.key} className={getRowClassName(row, index)}>
                <td
                  className={`px-4 py-3 ${
                    row.kind === "section"
                      ? "font-semibold uppercase"
                      : row.kind === "subtotal" || row.kind === "total"
                        ? "font-semibold"
                        : ""
                  }`}
                >
                  {row.label}
                </td>
                {row.kind === "section" ? (
                  <>
                    {MONTH_LABELS.map((month) => (
                      <td key={month} className="px-4 py-3" />
                    ))}
                    <td className={fullYearCellClassName} />
                  </>
                ) : (
                  <>
                    {row.amounts
                      .slice(0, FULL_YEAR_INDEX)
                      .map((amount, monthIndex) => (
                        <td key={monthIndex} className="px-4 py-3">
                          {formatGHS(amount)}
                        </td>
                      ))}
                    <td className={fullYearCellClassName}>
                      {formatGHS(row.amounts[FULL_YEAR_INDEX] ?? 0)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
