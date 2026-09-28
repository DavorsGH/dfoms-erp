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
import type { BalanceSheetAccountsPayableEntry } from "./balance-sheet-ap-cash-utils";
import type {
  AccountsPayablePaymentRow,
  DirectorsLoanRepaymentRow,
} from "./directors-loan-utils";
import type { DirectorsLoanLedgerEntry } from "./directors-loan-ledger-utils";
import {
  buildNetPayByPayrollMonth,
  type MonthEndCloseNetPayEntry,
  type PayrollHistoryWagesEntry,
} from "./accrued-wages-utils";
import type { CustomerCreditsApplicationRow } from "./customer-credits-liability-utils";
import {
  FULL_YEAR_INDEX,
  MONTH_LABELS,
  buildCashFlowReport,
  filterManualEntriesForYear,
  type CashFlowRow,
} from "./cash-flow-utils";
import {
  FinancialStatementScrollableTable,
  scrollableTableFinancialStatementClassName,
  scrollableTableFinancialStatementHeadClassName,
  scrollableTableFinancialStatementLineItemTdClassName,
  scrollableTableFinancialStatementLineItemThClassName,
  scrollableTableFinancialStatementThClassName,
  scrollableTableStatementSectionRowClassName,
  type ScrollableTableFinancialStatementLineItemKind,
} from "../scrollable-table";

type CashFlowProps = {
  tenantId: string;
  initialIncomeEntries: CashFlowIncomeEntry[];
  initialExpenseEntries: CashFlowExpenseEntry[];
  initialManualEntries: ManualFinancialEntry[];
  initialInventoryPurchases: CashFlowInventoryPurchaseInput;
  initialFixedAssets: ProfitLossAssetEntry[];
  initialCapitalContributions: CapitalContributionEntry[];
  initialPayableEntries?: BalanceSheetAccountsPayableEntry[];
  initialAccountsPayablePayments?: AccountsPayablePaymentRow[];
  initialDirectorsLoanRepayments?: DirectorsLoanRepaymentRow[];
  initialDirectorsLoanLedgerEntries?: DirectorsLoanLedgerEntry[];
  /** Same payroll inputs Balance Sheet uses to build the staff-salary net map. */
  initialPayrollHistory?: PayrollHistoryWagesEntry[];
  initialMonthEndCloseNetPay?: MonthEndCloseNetPayEntry[];
  initialCreditNoteApplications?: CustomerCreditsApplicationRow[];
  availableYears: number[];
  fetchError: string | null;
};

const fullYearCellClassName =
  "bg-slate-100 px-4 py-3 text-[#0f2744]";

function cashFlowLineItemKind(
  row: CashFlowRow,
): ScrollableTableFinancialStatementLineItemKind {
  if (row.kind === "section") return "section";
  if (row.kind === "subtotal") return "subtotal";
  if (row.kind === "total") return "total";
  return "normal";
}

function formatAmount(amount: number): string {
  return formatGHS(amount);
}

function getRowClassName(row: CashFlowRow, index: number): string {
  if (row.kind === "section") {
    return scrollableTableStatementSectionRowClassName;
  }

  if (row.kind === "subtotal" || row.kind === "total") {
    return "bg-slate-50 text-sm font-semibold text-[#0f2744]";
  }

  if (row.kind === "metric" || row.kind === "balance") {
    return "bg-slate-50 text-sm text-[#0f2744]";
  }

  return index % 2 === 1
    ? "bg-slate-50 text-sm text-slate-700"
    : "text-sm text-slate-700";
}

function getFullYearAmount(row: CashFlowRow): number {
  return row.amounts[FULL_YEAR_INDEX] ?? 0;
}

export default function CashFlow({
  tenantId,
  initialIncomeEntries,
  initialExpenseEntries,
  initialManualEntries,
  initialInventoryPurchases,
  initialFixedAssets,
  initialCapitalContributions,
  initialPayableEntries = [],
  initialAccountsPayablePayments = [],
  initialDirectorsLoanRepayments = [],
  initialDirectorsLoanLedgerEntries = [],
  initialPayrollHistory = [],
  initialMonthEndCloseNetPay = [],
  initialCreditNoteApplications = [],
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

  const staffSalaryNetByPayrollMonth = useMemo(
    () =>
      buildNetPayByPayrollMonth(
        initialPayrollHistory,
        initialMonthEndCloseNetPay,
      ),
    [initialPayrollHistory, initialMonthEndCloseNetPay],
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
        staffSalaryNetByPayrollMonth,
        initialPayableEntries,
        {
          tenantId,
          accountsPayablePayments: initialAccountsPayablePayments,
          directorsLoanRepayments: initialDirectorsLoanRepayments,
          directorsLoanLedgerEntries: initialDirectorsLoanLedgerEntries,
          creditNoteApplications: initialCreditNoteApplications,
        },
      ),
    [
      tenantId,
      initialIncomeEntries,
      initialExpenseEntries,
      initialCapitalContributions,
      initialFixedAssets,
      initialInventoryPurchases,
      initialPayableEntries,
      initialAccountsPayablePayments,
      initialDirectorsLoanRepayments,
      initialDirectorsLoanLedgerEntries,
      initialCreditNoteApplications,
      staffSalaryNetByPayrollMonth,
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
          live from receipts, paid expenses, AP settlements, fixed-asset
          purchases, and manual financing/opening entries.
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

      <FinancialStatementScrollableTable>
        <table className={scrollableTableFinancialStatementClassName}>
          <thead className={scrollableTableFinancialStatementHeadClassName}>
            <tr>
              <th className={scrollableTableFinancialStatementLineItemThClassName}>
                Line Item
              </th>
              {MONTH_LABELS.map((month) => (
                <th
                  key={month}
                  className={`${scrollableTableFinancialStatementThClassName} whitespace-nowrap`}
                >
                  {month} {report.financialYear}
                </th>
              ))}
              <th
                className={`${scrollableTableFinancialStatementThClassName} whitespace-nowrap`}
              >
                Full Year
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {report.rows.map((row, index) => (
              <tr key={row.key} className={getRowClassName(row, index)}>
                <td
                  className={scrollableTableFinancialStatementLineItemTdClassName(
                    cashFlowLineItemKind(row),
                  )}
                >
                  {row.label}
                </td>
                {row.kind === "section" ? (
                  <>
                    {MONTH_LABELS.map((month) => (
                      <td key={month} className="px-4 py-3" />
                    ))}
                    <td className="px-4 py-3" />
                  </>
                ) : (
                  <>
                    {row.amounts
                      .slice(0, FULL_YEAR_INDEX)
                      .map((amount, monthIndex) => (
                        <td
                          key={monthIndex}
                          className="whitespace-nowrap px-4 py-3"
                        >
                          {formatAmount(amount)}
                        </td>
                      ))}
                    <td
                      className={`whitespace-nowrap ${fullYearCellClassName}${
                        row.kind === "subtotal" || row.kind === "total"
                          ? " font-semibold"
                          : ""
                      }`}
                    >
                      {formatAmount(getFullYearAmount(row))}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </FinancialStatementScrollableTable>

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
