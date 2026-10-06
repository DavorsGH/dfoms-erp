import type { BalanceSheetPageData } from "@/app/dashboard/finance/balance-sheet-page-data";
import { buildCustomerCreditsBalanceSheetOptions } from "@/app/dashboard/finance/balance-sheet-page-data";
import type { CashMovementManualEntry } from "@/app/dashboard/finance/cash-movement-utils";

export type StandardBalanceSheetDataSlice = Pick<
  BalanceSheetPageData,
  | "initialAccountsPayablePayments"
  | "initialDirectorsLoanRepayments"
  | "initialDirectorsLoanLedgerEntries"
  | "initialCreditNotesForCustomerCredits"
  | "initialRefundsForCustomerCredits"
  | "initialCreditNoteApplications"
>;

export type StandardBalanceSheetReportData = StandardBalanceSheetDataSlice &
  Pick<
    BalanceSheetPageData,
    | "initialIncomeEntries"
    | "initialExpenseEntries"
    | "initialFixedAssets"
    | "initialPayableEntries"
    | "initialCapitalContributions"
    | "initialCashFlowExpenseEntries"
    | "initialPayrollHistory"
    | "initialMonthEndCloseNetPay"
    | "initialInventoryBalanceSheet"
    | "initialTaxLedgerEntries"
    | "initialWelfareFundEntries"
  > & {
  initialManualEntries: CashMovementManualEntry[];
};
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  type BalanceSheetReport,
  type BalanceSheetReportOptions,
} from "@/app/dashboard/finance/balance-sheet-utils";

export type StandardBalanceSheetReportExtras = {
  allBusinessUnitsDirectorsLoan?: boolean;
  rawManualFinancialEntries?: CashMovementManualEntry[];
};

export function buildStandardBalanceSheetReportOptions(
  tenantId: string,
  data: StandardBalanceSheetDataSlice,
  extras: StandardBalanceSheetReportExtras = {},
): BalanceSheetReportOptions {
  return {
    tenantId,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    directorsLoanLedgerEntries: data.initialDirectorsLoanLedgerEntries,
    allBusinessUnitsDirectorsLoan: extras.allBusinessUnitsDirectorsLoan,
    rawManualFinancialEntries: extras.rawManualFinancialEntries,
    ...buildCustomerCreditsBalanceSheetOptions(data),
  };
}

export function buildStandardBalanceSheetReport(
  data: StandardBalanceSheetReportData,
  tenantId: string,
  financialYear: number,
  extras: StandardBalanceSheetReportExtras = {},
): BalanceSheetReport {
  return buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    financialYear,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    data.initialWelfareFundEntries,
    buildStandardBalanceSheetReportOptions(tenantId, data, extras),
  );
}

export type BalanceSheetMonthCheck = {
  monthIndex: number;
  isBalanced: boolean;
  difference: number;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
};

export function runBalanceSheetMonthChecks(
  report: BalanceSheetReport,
  monthIndices: number[],
): BalanceSheetMonthCheck[] {
  return monthIndices.map((monthIndex) => {
    const check = getBalanceCheckForPeriod(report, monthIndex);
    return {
      monthIndex,
      isBalanced: check.isBalanced,
      difference: check.difference,
      totalAssets: check.totalAssets,
      totalLiabilitiesAndEquity: check.totalLiabilitiesAndEquity,
    };
  });
}

export function getBalanceSheetMonthCheck(
  report: BalanceSheetReport,
  monthIndex: number,
): BalanceSheetMonthCheck {
  return runBalanceSheetMonthChecks(report, [monthIndex])[0]!;
}
