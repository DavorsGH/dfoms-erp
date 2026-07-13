"use client";

import { useMemo, useState } from "react";
import { getDefaultSelectedYear } from "./finance-year-utils";
import FinancialYearSelector from "./financial-year-selector";
import { formatGHS } from "./income-register-utils";
import { formatPercent } from "./fixed-assets-utils";
import {
  FULL_YEAR_INDEX,
  MONTH_LABELS,
  buildProfitLossReport,
  type ProfitLossAssetEntry,
  type ProfitLossExpenseEntry,
  type ProfitLossIncomeEntry,
  type ProfitLossRow,
} from "./profit-loss-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

type ProfitLossProps = {
  initialIncomeEntries: ProfitLossIncomeEntry[];
  initialExpenseEntries: ProfitLossExpenseEntry[];
  initialFixedAssets: ProfitLossAssetEntry[];
  availableYears: number[];
  fetchError: string | null;
};

const fullYearHeaderClassName =
  "sticky top-0 z-10 bg-slate-200 px-4 py-3 font-semibold text-[#0f2744]";

const fullYearCellClassName =
  "bg-slate-100 px-4 py-3 font-semibold text-[#0f2744]";

function formatAmount(row: ProfitLossRow, amount: number): string {
  if (row.kind === "percent") {
    return formatPercent(amount);
  }

  return formatGHS(amount);
}

function getRowClassName(row: ProfitLossRow, index: number): string {
  if (row.kind === "section") {
    return "bg-[#0f2744] text-sm font-semibold uppercase tracking-wide text-white";
  }

  if (row.kind === "subtotal" || row.kind === "total" || row.kind === "metric") {
    return "bg-slate-50 text-sm font-semibold text-[#0f2744]";
  }

  return index % 2 === 1 ? "bg-slate-50 text-slate-700" : "text-slate-700";
}

export default function ProfitLoss({
  initialIncomeEntries,
  initialExpenseEntries,
  initialFixedAssets,
  availableYears,
  fetchError,
}: ProfitLossProps) {
  const [selectedYear, setSelectedYear] = useState(() =>
    getDefaultSelectedYear(availableYears),
  );

  const report = useMemo(
    () =>
      buildProfitLossReport(
        initialIncomeEntries,
        initialExpenseEntries,
        initialFixedAssets,
        selectedYear,
      ),
    [
      initialIncomeEntries,
      initialExpenseEntries,
      initialFixedAssets,
      selectedYear,
    ],
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-slate-600">
          Monthly profit and loss for financial year {report.financialYear},
          calculated live from income, expenses, and fixed asset depreciation.
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
                          row.kind === "metric"
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
                          {formatAmount(row, amount)}
                        </td>
                      ))}
                    <td className={fullYearCellClassName}>
                      {formatAmount(row, row.amounts[FULL_YEAR_INDEX] ?? 0)}
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
