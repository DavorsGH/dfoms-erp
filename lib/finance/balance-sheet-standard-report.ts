import type { BalanceSheetPageData } from "@/app/dashboard/finance/balance-sheet-page-data";
import { buildCustomerCreditsBalanceSheetOptions } from "@/app/dashboard/finance/balance-sheet-page-data";
import type { CashMovementManualEntry } from "@/app/dashboard/finance/cash-movement-utils";
import type { StaffAdvanceBalanceSheetEntry } from "@/app/dashboard/finance/staff-advances-balance-sheet-utils";
import {
  resolveInterUnitTransferCashScope,
  type BusinessUnitTransferRecord,
  type InterUnitTransferCashScope,
} from "@/app/dashboard/finance/business-unit-transfers-utils";
import type {
  DividendBalanceSheetDeclaration,
  DividendBalanceSheetLine,
} from "@/app/dashboard/finance/dividends-types";
import { resolveBalanceSheetDividendBusinessUnitId } from "@/lib/finance/dividends-load";
import type { DividendBalanceSheetFilter } from "@/app/dashboard/finance/dividends-balance-sheet-utils";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";

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
    | "initialDividendDeclarations"
    | "initialDividendLines"
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
  initialStaffSalaryAdvanceEntries?: StaffAdvanceBalanceSheetEntry[];
  initialManualEntries: CashMovementManualEntry[];
  initialBusinessUnitTransfers?: BusinessUnitTransferRecord[];
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
  interUnitTransferScope?: InterUnitTransferCashScope;
  dividendDeclarations?: DividendBalanceSheetDeclaration[];
  dividendLines?: DividendBalanceSheetLine[];
  balanceSheetBusinessUnitId?: string | null;
  dividendBalanceSheetFilter?: DividendBalanceSheetFilter;
};

/**
 * Report extras aligned with balance-sheet.tsx / cash-flow.tsx view scoping
 * (directors loan aggregation, inter-unit cash, dividend/cash BU filter).
 */
export function standardBalanceSheetReportExtrasForView(args: {
  viewAllBusinessUnits: boolean;
  activeBusinessUnitId: string | null;
  rawManualFinancialEntries?: CashMovementManualEntry[];
}): StandardBalanceSheetReportExtras {
  const dividendBalanceSheetFilter: DividendBalanceSheetFilter =
    args.viewAllBusinessUnits
      ? { mode: "all" }
      : args.activeBusinessUnitId
        ? { mode: "unit", businessUnitId: args.activeBusinessUnitId }
        : { mode: "none" };

  return {
    allBusinessUnitsDirectorsLoan: args.viewAllBusinessUnits,
    rawManualFinancialEntries: args.viewAllBusinessUnits
      ? args.rawManualFinancialEntries
      : undefined,
    interUnitTransferScope: resolveInterUnitTransferCashScope({
      viewAllBusinessUnits: args.viewAllBusinessUnits,
      activeBusinessUnitId: args.activeBusinessUnitId,
    }),
    balanceSheetBusinessUnitId: args.viewAllBusinessUnits
      ? null
      : args.activeBusinessUnitId,
    dividendBalanceSheetFilter,
  };
}

export function dividendOptionsFromPageData(
  data: Pick<
    BalanceSheetPageData,
    "initialDividendDeclarations" | "initialDividendLines"
  >,
  buScope: BusinessUnitReadScope,
): Pick<
  BalanceSheetReportOptions,
  "dividendDeclarations" | "dividendLines" | "balanceSheetBusinessUnitId"
> {
  return {
    dividendDeclarations: data.initialDividendDeclarations ?? [],
    dividendLines: data.initialDividendLines ?? [],
    balanceSheetBusinessUnitId: resolveBalanceSheetDividendBusinessUnitId(buScope),
  };
}

export function buildStandardBalanceSheetReportOptions(
  tenantId: string,
  data: StandardBalanceSheetDataSlice & {
    initialStaffSalaryAdvanceEntries?: StaffAdvanceBalanceSheetEntry[];
    initialBusinessUnitTransfers?: BusinessUnitTransferRecord[];
    initialDividendDeclarations?: DividendBalanceSheetDeclaration[];
    initialDividendLines?: DividendBalanceSheetLine[];
  },
  extras: StandardBalanceSheetReportExtras = {},
): BalanceSheetReportOptions {
  return {
    tenantId,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    directorsLoanLedgerEntries: data.initialDirectorsLoanLedgerEntries,
    allBusinessUnitsDirectorsLoan: extras.allBusinessUnitsDirectorsLoan,
    rawManualFinancialEntries: extras.rawManualFinancialEntries,
    ...buildCustomerCreditsBalanceSheetOptions({
      ...data,
      initialStaffSalaryAdvanceEntries: data.initialStaffSalaryAdvanceEntries ?? [],
    }),
    businessUnitTransfers: data.initialBusinessUnitTransfers,
    interUnitTransferScope: extras.interUnitTransferScope,
    dividendDeclarations:
      extras.dividendDeclarations ?? data.initialDividendDeclarations ?? [],
    dividendLines: extras.dividendLines ?? data.initialDividendLines ?? [],
    balanceSheetBusinessUnitId: extras.balanceSheetBusinessUnitId ?? null,
    dividendBalanceSheetFilter: extras.dividendBalanceSheetFilter,
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
  roundingDifference: number | null;
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
      roundingDifference: check.roundingDifference,
    };
  });
}

export function getBalanceSheetMonthCheck(
  report: BalanceSheetReport,
  monthIndex: number,
): BalanceSheetMonthCheck {
  return runBalanceSheetMonthChecks(report, [monthIndex])[0]!;
}
