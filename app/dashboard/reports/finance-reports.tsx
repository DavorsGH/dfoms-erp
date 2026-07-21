"use client";

import { useMemo, useState } from "react";
import { getStripedRowClassName } from "../finance/register-row-actions";
import { buildBalanceSheetReport, getBalanceCheckForPeriod, getBalanceSheetForMonth, type InventoryBalanceSheetInput } from "../finance/balance-sheet-utils";
import type { CapitalContributionEntry } from "../finance/capital-contributions-utils";
import { getContributorName } from "../finance/capital-contributions-utils";
import { buildCashFlowReport, filterManualEntriesForYear } from "../finance/cash-flow-utils";
import type {
  CashFlowExpenseEntry,
  CashFlowIncomeEntry,
  CashFlowInventoryPurchaseInput,
  ManualFinancialEntry,
} from "../finance/cash-flow-utils";
import { formatPercent } from "../finance/fixed-assets-utils";
import { formatGHS } from "../finance/income-register-utils";
import {
  buildProfitLossReport,
  type ProfitLossAssetEntry,
  type ProfitLossExpenseEntry,
  type ProfitLossIncomeEntry,
} from "../finance/profit-loss-utils";
import type { AccountsPayableEntry } from "../finance/accounts-payable-utils";
import type { IncomeRegisterEntry } from "../finance/income-register-utils";
import type {
  BalanceSheetAccountsPayableEntry,
  BalanceSheetIncomeEntry,
} from "../finance/balance-sheet-utils";
import type {
  BalanceSheetCashExpenseEntry,
  MonthEndCloseNetPayEntry,
  PayrollHistoryWagesEntry,
} from "../finance/accrued-wages-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  AGING_BUCKET_LABELS,
  buildAccountsReceivableAgingReport,
  buildCapitalContributionsSummary,
  buildExpenseReport,
  buildFixedAssetDepreciationSchedule,
  buildStatutoryLiabilitiesReport,
  extractStatementRowsForMonth,
  formatReportPeriodLabel,
  getDefaultReportMonthYear,
  monthIndexFromMonthNumber,
  type AgingBucketKey,
  type ExpenseReportSourceEntry,
  type FixedAssetScheduleAsset,
  type StatementReportRow,
} from "./finance-reports-utils";
import {
  FINANCE_REPORT_PRINT_AREA_ID,
  ReportActionBar,
  ReportCompanyHeader,
  ReportMonthYearSelector,
  ReportPrintStyles,
  downloadCsv,
  formatDaysUntilDue,
  formatReportCurrency,
  formatReportDate,
} from "./report-ui";

type FetchErrorProps = {
  fetchError: string | null;
};

function ReportFetchError({ fetchError }: FetchErrorProps) {
  if (!fetchError) {
    return null;
  }

  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {fetchError}
    </p>
  );
}

function useMonthYearSelection(availableYears: number[]) {
  const defaults = getDefaultReportMonthYear();
  const [year, setYear] = useState(
    availableYears.includes(defaults.year)
      ? defaults.year
      : (availableYears[0] ?? defaults.year),
  );
  const [month, setMonth] = useState(defaults.month);
  const monthIndex = monthIndexFromMonthNumber(month);
  const periodLabel = formatReportPeriodLabel(year, month);

  return {
    year,
    month,
    setYear,
    setMonth,
    monthIndex,
    periodLabel,
  };
}

function handleReportPrint() {
  window.print();
}

function formatStatementAmount(row: StatementReportRow): string {
  if (row.kind === "section") {
    return "";
  }

  if (row.kind === "percent") {
    return formatPercent(row.amount);
  }

  return formatGHS(row.amount);
}

function getStatementRowClassName(
  row: StatementReportRow,
  index: number,
): string {
  if (row.kind === "section") {
    return "bg-[#0f2744] text-sm font-semibold uppercase tracking-wide text-white";
  }

  if (row.kind === "subtotal" || row.kind === "total" || row.kind === "metric") {
    return "bg-slate-50 text-sm font-semibold text-[#0f2744]";
  }

  return getStripedRowClassName(index);
}

function StatementReportTable({ rows }: { rows: StatementReportRow[] }) {
  return (
    <ScrollableTable>
      <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>Line Item</th>
            <th className={`${scrollableTableThClassName} text-right`}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.map((row, index) => (
            <tr key={row.key} className={getStatementRowClassName(row, index)}>
              <td className="px-4 py-3">{row.label}</td>
              <td className="px-4 py-3 text-right">
                {formatStatementAmount(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  );
}

function BalanceCheckBanner({
  periodLabel,
  totalAssets,
  totalLiabilitiesAndEquity,
  difference,
  isBalanced,
}: {
  periodLabel: string;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  difference: number;
  isBalanced: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
        Balance Check — {periodLabel}
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-xs text-slate-500">Total Assets</p>
          <p className="font-semibold text-[#0f2744]">
            {formatGHS(totalAssets)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Total Liabilities + Equity</p>
          <p className="font-semibold text-[#0f2744]">
            {formatGHS(totalLiabilitiesAndEquity)}
          </p>
        </div>
      </div>
      <p
        className={`mt-3 rounded-md px-3 py-2 text-sm font-medium ${
          isBalanced
            ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border border-red-200 bg-red-50 text-red-800"
        }`}
      >
        {isBalanced
          ? "Balanced"
          : `Out of balance by ${formatGHS(Math.abs(difference))}`}
      </p>
    </section>
  );
}

const AGING_BUCKET_ROW_CLASS: Record<AgingBucketKey, string> = {
  current: "bg-white text-slate-700",
  "1-30": "bg-amber-50 text-slate-700",
  "31-60": "bg-orange-50 text-slate-700",
  "61-90": "bg-red-50 text-slate-700",
  "90+": "bg-red-100 text-slate-800",
};

export function MonthlyPlReport({
  initialIncomeEntries,
  initialExpenseEntries,
  initialFixedAssets,
  availableYears,
  fetchError,
}: {
  initialIncomeEntries: ProfitLossIncomeEntry[];
  initialExpenseEntries: ProfitLossExpenseEntry[];
  initialFixedAssets: ProfitLossAssetEntry[];
  availableYears: number[];
  fetchError: string | null;
}) {
  const { year, month, setYear, setMonth, monthIndex, periodLabel } =
    useMonthYearSelection(availableYears);

  const report = useMemo(
    () =>
      buildProfitLossReport(
        initialIncomeEntries,
        initialExpenseEntries,
        initialFixedAssets,
        year,
      ),
    [initialIncomeEntries, initialExpenseEntries, initialFixedAssets, year],
  );

  const rows = useMemo(
    () => extractStatementRowsForMonth(report.rows, monthIndex),
    [report.rows, monthIndex],
  );

  function exportCsv() {
    downloadCsv(
      `monthly-pl-${year}-${String(month).padStart(2, "0")}.csv`,
      ["Line Item", "Amount"],
      rows.map((row) => [row.label, formatStatementAmount(row)]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={rows.length === 0}
      >
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <div
        id={FINANCE_REPORT_PRINT_AREA_ID}
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <ReportCompanyHeader
          title="Monthly Profit & Loss Statement"
          periodLabel={periodLabel}
        />
        <StatementReportTable rows={rows} />
      </div>
    </div>
  );
}

export function MonthlyBalanceSheetReport({
  initialIncomeEntries,
  initialExpenseEntries,
  initialFixedAssets,
  initialPayableEntries,
  initialCapitalContributions,
  initialCashFlowExpenseEntries,
  initialPayrollHistory,
  initialMonthEndCloseNetPay,
  initialInventoryBalanceSheet,
  availableYears,
  fetchError,
}: {
  initialIncomeEntries: BalanceSheetIncomeEntry[];
  initialExpenseEntries: ProfitLossExpenseEntry[];
  initialFixedAssets: ProfitLossAssetEntry[];
  initialPayableEntries: BalanceSheetAccountsPayableEntry[];
  initialCapitalContributions: CapitalContributionEntry[];
  initialCashFlowExpenseEntries: BalanceSheetCashExpenseEntry[];
  initialPayrollHistory: PayrollHistoryWagesEntry[];
  initialMonthEndCloseNetPay: MonthEndCloseNetPayEntry[];
  initialInventoryBalanceSheet: InventoryBalanceSheetInput;
  availableYears: number[];
  fetchError: string | null;
}) {
  const { year, month, setYear, setMonth, monthIndex, periodLabel } =
    useMonthYearSelection(availableYears);

  const report = useMemo(
    () =>
      buildBalanceSheetReport(
        initialIncomeEntries,
        initialExpenseEntries,
        initialFixedAssets,
        initialPayableEntries,
        initialCapitalContributions,
        initialCashFlowExpenseEntries,
        initialPayrollHistory,
        initialMonthEndCloseNetPay,
        year,
        initialInventoryBalanceSheet,
      ),
    [
      initialIncomeEntries,
      initialExpenseEntries,
      initialFixedAssets,
      initialPayableEntries,
      initialCapitalContributions,
      initialCashFlowExpenseEntries,
      initialPayrollHistory,
      initialMonthEndCloseNetPay,
      initialInventoryBalanceSheet,
      year,
    ],
  );

  const rows = useMemo(
    () => getBalanceSheetForMonth(report, monthIndex),
    [report, monthIndex],
  );

  const balanceCheck = useMemo(
    () => getBalanceCheckForPeriod(report, monthIndex),
    [report, monthIndex],
  );

  function exportCsv() {
    downloadCsv(
      `monthly-balance-sheet-${year}-${String(month).padStart(2, "0")}.csv`,
      ["Line Item", "Amount"],
      rows.map((row) => [row.label, formatStatementAmount(row)]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={rows.length === 0}
      >
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <div
        id={FINANCE_REPORT_PRINT_AREA_ID}
        className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <ReportCompanyHeader
          title="Monthly Balance Sheet"
          periodLabel={periodLabel}
        />
        <BalanceCheckBanner periodLabel={periodLabel} {...balanceCheck} />
        <StatementReportTable rows={rows} />
      </div>
    </div>
  );
}

export function CashFlowStatementReport({
  initialIncomeEntries,
  initialExpenseEntries,
  initialManualEntries,
  initialInventoryPurchases,
  availableYears,
  fetchError,
}: {
  initialIncomeEntries: CashFlowIncomeEntry[];
  initialExpenseEntries: CashFlowExpenseEntry[];
  initialManualEntries: ManualFinancialEntry[];
  initialInventoryPurchases: CashFlowInventoryPurchaseInput;
  availableYears: number[];
  fetchError: string | null;
}) {
  const { year, month, setYear, setMonth, monthIndex, periodLabel } =
    useMonthYearSelection(availableYears);

  const manualEntriesForYear = useMemo(
    () => filterManualEntriesForYear(initialManualEntries, year),
    [initialManualEntries, year],
  );

  const report = useMemo(
    () =>
      buildCashFlowReport(
        initialIncomeEntries,
        initialExpenseEntries,
        manualEntriesForYear,
        year,
        initialInventoryPurchases,
      ),
    [
      initialIncomeEntries,
      initialExpenseEntries,
      initialInventoryPurchases,
      manualEntriesForYear,
      year,
    ],
  );

  const rows = useMemo(
    () => extractStatementRowsForMonth(report.rows, monthIndex),
    [report.rows, monthIndex],
  );

  function exportCsv() {
    downloadCsv(
      `cash-flow-${year}-${String(month).padStart(2, "0")}.csv`,
      ["Line Item", "Amount"],
      rows.map((row) => [row.label, formatStatementAmount(row)]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={rows.length === 0}
      >
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <div
        id={FINANCE_REPORT_PRINT_AREA_ID}
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <ReportCompanyHeader
          title="Cash Flow Statement"
          periodLabel={periodLabel}
        />
        <StatementReportTable rows={rows} />
      </div>
    </div>
  );
}

export function ArAgingReport({
  initialIncomeEntries,
  fetchError,
}: {
  initialIncomeEntries: IncomeRegisterEntry[];
  fetchError: string | null;
}) {
  const report = useMemo(
    () => buildAccountsReceivableAgingReport(initialIncomeEntries),
    [initialIncomeEntries],
  );

  function exportCsv() {
    downloadCsv(
      "accounts-receivable-aging.csv",
      [
        "Invoice Number",
        "Customer Name",
        "Invoice Date",
        "Due Date",
        "Amount",
        "Amount Received",
        "Outstanding Balance",
        "Days Overdue",
        "Aging Bucket",
      ],
      report.rows.map((row) => [
        row.invoiceNo,
        row.customerName,
        row.invoiceDate,
        row.dueDate,
        row.amount,
        row.amountReceived,
        row.outstandingBalance,
        row.daysOverdue,
        AGING_BUCKET_LABELS[row.bucket],
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={report.rows.length === 0}
      />
      <ReportFetchError fetchError={fetchError} />
      <div
        id={FINANCE_REPORT_PRINT_AREA_ID}
        className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <ReportCompanyHeader
          title="Accounts Receivable Aging"
          periodLabel={`As at ${formatReportDate(new Date().toISOString())}`}
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(Object.keys(AGING_BUCKET_LABELS) as AgingBucketKey[]).map(
            (bucket) => (
              <div
                key={bucket}
                className={`rounded-md border border-slate-200 px-4 py-3 ${AGING_BUCKET_ROW_CLASS[bucket]}`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {AGING_BUCKET_LABELS[bucket]}
                </p>
                <p className="mt-1 text-lg font-semibold text-[#0f2744]">
                  {formatReportCurrency(report.bucketTotals[bucket])}
                </p>
              </div>
            ),
          )}
          <div className="rounded-md border border-[#0f2744]/20 bg-[#0f2744]/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Total Outstanding
            </p>
            <p className="mt-1 text-lg font-semibold text-[#0f2744]">
              {formatReportCurrency(report.totalOutstanding)}
            </p>
          </div>
        </div>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Invoice No.</th>
                <th className={scrollableTableThClassName}>Customer</th>
                <th className={scrollableTableThClassName}>Invoice Date</th>
                <th className={scrollableTableThClassName}>Due Date</th>
                <th className={scrollableTableThClassName}>Amount</th>
                <th className={scrollableTableThClassName}>Received</th>
                <th className={scrollableTableThClassName}>Outstanding</th>
                <th className={scrollableTableThClassName}>Days Overdue</th>
                <th className={scrollableTableThClassName}>Bucket</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No outstanding receivables.
                  </td>
                </tr>
              ) : (
                report.rows.map((row, index) => (
                  <tr
                    key={`${row.invoiceNo}-${row.dueDate}`}
                    className={AGING_BUCKET_ROW_CLASS[row.bucket]}
                  >
                    <td className="px-4 py-3">{row.invoiceNo}</td>
                    <td className="px-4 py-3">{row.customerName}</td>
                    <td className="px-4 py-3">
                      {formatReportDate(row.invoiceDate)}
                    </td>
                    <td className="px-4 py-3">
                      {formatReportDate(row.dueDate)}
                    </td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.amount)}
                    </td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.amountReceived)}
                    </td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.outstandingBalance)}
                    </td>
                    <td className="px-4 py-3">{row.daysOverdue}</td>
                    <td className="px-4 py-3">
                      {AGING_BUCKET_LABELS[row.bucket]}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </div>
    </div>
  );
}

export function StatutoryLiabilitiesReport({
  initialPayables,
  initialManualEntries,
  fetchError,
}: {
  initialPayables: AccountsPayableEntry[];
  initialManualEntries: ManualFinancialEntry[];
  fetchError: string | null;
}) {
  const report = useMemo(
    () =>
      buildStatutoryLiabilitiesReport(initialPayables, initialManualEntries),
    [initialPayables, initialManualEntries],
  );

  function exportCsv() {
    downloadCsv(
      "statutory-liabilities.csv",
      ["Type", "Description", "Amount", "Due Date", "Days Until Due"],
      report.rows.map((row) => [
        row.group,
        row.description,
        row.amount,
        row.dueDate ?? "",
        row.daysUntilDue ?? "",
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={report.rows.length === 0}
      />
      <ReportFetchError fetchError={fetchError} />
      <div
        id={FINANCE_REPORT_PRINT_AREA_ID}
        className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <ReportCompanyHeader
          title="Statutory Liabilities Report"
          periodLabel={`As at ${formatReportDate(new Date().toISOString())}`}
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(
            ["SSNIT", "PAYE", "VAT", "WHT Payable"] as const
          ).map((group) => (
            <div
              key={group}
              className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {group}
              </p>
              <p className="mt-1 text-lg font-semibold text-[#0f2744]">
                {formatReportCurrency(report.groupTotals[group])}
              </p>
            </div>
          ))}
        </div>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Type</th>
                <th className={scrollableTableThClassName}>Description</th>
                <th className={scrollableTableThClassName}>Amount</th>
                <th className={scrollableTableThClassName}>Due Date</th>
                <th className={scrollableTableThClassName}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No statutory liabilities found.
                  </td>
                </tr>
              ) : (
                report.rows.map((row, index) => (
                  <tr key={`${row.group}-${row.description}-${index}`} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{row.group}</td>
                    <td className="px-4 py-3">{row.description}</td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.amount)}
                    </td>
                    <td className="px-4 py-3">
                      {formatReportDate(row.dueDate)}
                    </td>
                    <td className="px-4 py-3">
                      {formatDaysUntilDue(row.daysUntilDue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {report.rows.length > 0 ? (
              <tfoot>
                <tr className="bg-slate-50 font-semibold text-[#0f2744]">
                  <td className="px-4 py-3" colSpan={2}>
                    Grand Total
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.grandTotal)}
                  </td>
                  <td className="px-4 py-3" colSpan={2} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </ScrollableTable>
      </div>
    </div>
  );
}

export function FixedAssetScheduleReport({
  initialFixedAssets,
  availableYears,
  fetchError,
}: {
  initialFixedAssets: FixedAssetScheduleAsset[];
  availableYears: number[];
  fetchError: string | null;
}) {
  const { year, month, setYear, setMonth, periodLabel } =
    useMonthYearSelection(availableYears);

  const report = useMemo(
    () => buildFixedAssetDepreciationSchedule(initialFixedAssets, year, month),
    [initialFixedAssets, year, month],
  );

  function exportCsv() {
    downloadCsv(
      `fixed-asset-schedule-${year}-${String(month).padStart(2, "0")}.csv`,
      [
        "Asset Name",
        "Category",
        "Purchase Date",
        "Original Cost",
        "Accumulated Depreciation",
        "Net Book Value",
      ],
      [
        ...report.rows.map((row) => [
          row.assetName,
          row.category,
          row.purchaseDate,
          row.originalCost,
          row.accumulatedDepreciation,
          row.netBookValue,
        ]),
        [
          "Total",
          "",
          "",
          report.totalOriginalCost,
          report.totalAccumulatedDepreciation,
          report.totalNetBookValue,
        ],
      ],
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={report.rows.length === 0}
      >
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <div
        id={FINANCE_REPORT_PRINT_AREA_ID}
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <ReportCompanyHeader
          title="Fixed Asset & Depreciation Schedule"
          periodLabel={`As at ${periodLabel}`}
        />
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Asset Name</th>
                <th className={scrollableTableThClassName}>Category</th>
                <th className={scrollableTableThClassName}>Purchase Date</th>
                <th className={scrollableTableThClassName}>Original Cost</th>
                <th className={scrollableTableThClassName}>
                  Accumulated Depreciation
                </th>
                <th className={scrollableTableThClassName}>Net Book Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No fixed assets recorded.
                  </td>
                </tr>
              ) : (
                report.rows.map((row, index) => (
                  <tr key={row.assetId} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{row.assetName}</td>
                    <td className="px-4 py-3">{row.category}</td>
                    <td className="px-4 py-3">
                      {formatReportDate(row.purchaseDate)}
                    </td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.originalCost)}
                    </td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.accumulatedDepreciation)}
                    </td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.netBookValue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {report.rows.length > 0 ? (
              <tfoot>
                <tr className="bg-slate-50 font-semibold text-[#0f2744]">
                  <td className="px-4 py-3" colSpan={3}>
                    Total
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.totalOriginalCost)}
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.totalAccumulatedDepreciation)}
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.totalNetBookValue)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </ScrollableTable>
      </div>
    </div>
  );
}

export function CapitalContributionsReport({
  initialContributions,
  fetchError,
}: {
  initialContributions: CapitalContributionEntry[];
  fetchError: string | null;
}) {
  const report = useMemo(
    () =>
      buildCapitalContributionsSummary(initialContributions, getContributorName),
    [initialContributions],
  );

  function exportCsv() {
    downloadCsv(
      "capital-contributions-summary.csv",
      ["Date", "Contributed By", "Amount", "Description", "Running Total"],
      report.rows.map((row) => [
        row.date,
        row.contributedBy,
        row.amount,
        row.description,
        row.runningTotal,
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={report.rows.length === 0}
      />
      <ReportFetchError fetchError={fetchError} />
      <div
        id={FINANCE_REPORT_PRINT_AREA_ID}
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <ReportCompanyHeader
          title="Capital Contributions Summary"
          periodLabel="All contributions"
        />
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Contributed By</th>
                <th className={scrollableTableThClassName}>Amount</th>
                <th className={scrollableTableThClassName}>Description</th>
                <th className={scrollableTableThClassName}>Running Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No capital contributions recorded.
                  </td>
                </tr>
              ) : (
                report.rows.map((row, index) => (
                  <tr key={row.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{formatReportDate(row.date)}</td>
                    <td className="px-4 py-3">{row.contributedBy}</td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.amount)}
                    </td>
                    <td className="px-4 py-3">{row.description}</td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.runningTotal)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {report.rows.length > 0 ? (
              <tfoot>
                <tr className="bg-slate-50 font-semibold text-[#0f2744]">
                  <td className="px-4 py-3" colSpan={2}>
                    Grand Total
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.grandTotal)}
                  </td>
                  <td className="px-4 py-3" colSpan={2} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </ScrollableTable>
      </div>
    </div>
  );
}

export function ExpenseReport({
  initialExpenseEntries,
  availableYears,
  fetchError,
}: {
  initialExpenseEntries: ExpenseReportSourceEntry[];
  availableYears: number[];
  fetchError: string | null;
}) {
  const { year, month, setYear, setMonth, periodLabel } =
    useMonthYearSelection(availableYears);

  const report = useMemo(
    () => buildExpenseReport(initialExpenseEntries, year, month),
    [initialExpenseEntries, year, month],
  );

  const hasRows = report.groups.some((group) => group.rows.length > 0);

  function exportCsv() {
    const csvRows: Array<Array<string | number>> = [];

    for (const group of report.groups) {
      for (const row of group.rows) {
        csvRows.push([
          row.date,
          row.description,
          row.category,
          row.paymentStatus,
          row.amount,
        ]);
      }
      csvRows.push(["", "", `${group.category} Subtotal`, "", group.subtotal]);
    }

    csvRows.push(["", "", "GRAND TOTAL", "", report.grandTotal]);
    csvRows.push([]);
    csvRows.push(["", "", "Total Paid", "", report.totalPaid]);
    csvRows.push([
      "",
      "",
      "Total Accrued - Not Yet Paid",
      "",
      report.totalAccrued,
    ]);

    downloadCsv(
      `expense-report-${year}-${String(month).padStart(2, "0")}.csv`,
      ["Date", "Description", "Category", "Payment Status", "Amount"],
      csvRows,
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={!hasRows}
      >
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <div
        id={FINANCE_REPORT_PRINT_AREA_ID}
        className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <ReportCompanyHeader
          title="Expense Report"
          periodLabel={periodLabel}
        />
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Description</th>
                <th className={scrollableTableThClassName}>Category</th>
                <th className={scrollableTableThClassName}>Payment Status</th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {!hasRows ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No expenses recorded for {periodLabel}.
                  </td>
                </tr>
              ) : (
                report.groups.flatMap((group) => {
                  const dataRows = group.rows.map((row, index) => (
                    <tr key={row.key} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3">
                        {formatReportDate(row.date)}
                      </td>
                      <td className="px-4 py-3">{row.description}</td>
                      <td className="px-4 py-3">{row.category}</td>
                      <td className="px-4 py-3">{row.paymentStatus}</td>
                      <td className="px-4 py-3 text-right">
                        {formatReportCurrency(row.amount)}
                      </td>
                    </tr>
                  ));

                  return [
                    <tr
                      key={`section-${group.category}`}
                      className="bg-[#0f2744] text-sm font-semibold uppercase tracking-wide text-white"
                    >
                      <td className="px-4 py-3" colSpan={5}>
                        {group.category}
                      </td>
                    </tr>,
                    ...dataRows,
                    <tr
                      key={`subtotal-${group.category}`}
                      className="bg-slate-50 text-sm font-semibold text-[#0f2744]"
                    >
                      <td className="px-4 py-3" colSpan={4}>
                        {group.category} Subtotal
                      </td>
                      <td className="px-4 py-3 text-right">
                        {formatReportCurrency(group.subtotal)}
                      </td>
                    </tr>,
                  ];
                })
              )}
            </tbody>
            {hasRows ? (
              <tfoot>
                <tr className="bg-slate-100 text-sm font-semibold text-[#0f2744]">
                  <td className="px-4 py-3" colSpan={4}>
                    GRAND TOTAL
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatReportCurrency(report.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </ScrollableTable>
        {hasRows ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Total Paid
              </p>
              <p className="mt-1 text-lg font-semibold text-[#0f2744]">
                {formatReportCurrency(report.totalPaid)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Cash outflow (payment status = Paid)
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Total Accrued - Not Yet Paid
              </p>
              <p className="mt-1 text-lg font-semibold text-[#0f2744]">
                {formatReportCurrency(report.totalAccrued)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Excluded from Cash Position until paid
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
