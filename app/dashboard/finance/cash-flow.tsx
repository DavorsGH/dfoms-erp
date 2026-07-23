"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getDefaultSelectedYear } from "./finance-year-utils";
import FinancialYearSelector from "./financial-year-selector";
import { formatGHS } from "./income-register-utils";
import type { CashFlowExpenseEntry } from "./cash-flow-utils";
import type {
  CashFlowIncomeEntry,
  CashFlowInventoryPurchaseInput,
  ManualFinancialEntry,
} from "./cash-flow-utils";
import type { CapitalContributionEntry } from "./capital-contributions-utils";
import type { ProfitLossAssetEntry } from "./profit-loss-utils";
import {
  FULL_YEAR_INDEX,
  MONTH_LABELS,
  buildCashFlowReport,
  filterManualEntriesForYear,
  type CashFlowRow,
} from "./cash-flow-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

type CashFlowProps = {
  initialIncomeEntries: CashFlowIncomeEntry[];
  initialExpenseEntries: CashFlowExpenseEntry[];
  initialManualEntries: ManualFinancialEntry[];
  initialInventoryPurchases: CashFlowInventoryPurchaseInput;
  initialFixedAssets: ProfitLossAssetEntry[];
  initialCapitalContributions: CapitalContributionEntry[];
  availableYears: number[];
  fetchError: string | null;
};

const fullYearHeaderClassName =
  "sticky top-0 z-10 bg-slate-200 px-4 py-3 font-semibold text-[#0f2744]";

const fullYearCellClassName =
  "bg-slate-100 px-4 py-3 font-semibold text-[#0f2744]";

function formatAmount(amount: number): string {
  return formatGHS(amount);
}

function getRowClassName(row: CashFlowRow, index: number): string {
  if (row.kind === "section") {
    return "bg-[#0f2744] text-sm font-semibold uppercase tracking-wide text-white";
  }

  if (
    row.kind === "subtotal" ||
    row.kind === "total" ||
    row.kind === "metric" ||
    row.kind === "balance"
  ) {
    return "bg-slate-50 text-sm font-semibold text-[#0f2744]";
  }

  return index % 2 === 1 ? "bg-slate-50 text-slate-700" : "text-slate-700";
}

function getFullYearAmount(row: CashFlowRow): number {
  return row.amounts[FULL_YEAR_INDEX] ?? 0;
}

export default function CashFlow({
  initialIncomeEntries,
  initialExpenseEntries,
  initialManualEntries,
  initialInventoryPurchases,
  initialFixedAssets,
  initialCapitalContributions,
  availableYears,
  fetchError,
}: CashFlowProps) {
  const [selectedYear, setSelectedYear] = useState(() =>
    getDefaultSelectedYear(availableYears),
  );
  const [manualEntries, setManualEntries] = useState(initialManualEntries);

  const manualEntriesForYear = useMemo(
    () => filterManualEntriesForYear(manualEntries, selectedYear),
    [manualEntries, selectedYear],
  );

  const report = useMemo(
    () =>
      buildCashFlowReport(
        initialIncomeEntries,
        initialExpenseEntries,
        manualEntriesForYear,
        selectedYear,
        initialInventoryPurchases,
        initialFixedAssets,
        initialCapitalContributions,
      ),
    [
      initialIncomeEntries,
      initialExpenseEntries,
      initialCapitalContributions,
      initialFixedAssets,
      initialInventoryPurchases,
      manualEntriesForYear,
      selectedYear,
    ],
  );

  useEffect(() => {
    setManualEntries(initialManualEntries);
  }, [initialManualEntries]);

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-slate-600">
          Monthly cash flow for financial year {report.financialYear}, calculated
          live from receipts, paid expenses, fixed-asset purchases, and manual
          financing/opening entries.
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
                      : row.kind === "subtotal" ||
                          row.kind === "total" ||
                          row.kind === "metric" ||
                          row.kind === "balance"
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
                          {formatAmount(amount)}
                        </td>
                      ))}
                    <td className={fullYearCellClassName}>
                      {formatAmount(getFullYearAmount(row))}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>

      <p className="text-sm text-slate-600">
        Manual cash flow inputs are managed in{" "}
        <Link
          href="/dashboard/finance/manual-financial-entries"
          className="font-medium text-[#0f2744] underline-offset-2 hover:underline"
        >
          Manual Financial Entries
        </Link>
        .
      </p>
    </div>
  );
}
