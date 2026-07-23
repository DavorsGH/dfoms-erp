import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  type BalanceSheetAccountsPayableEntry,
  type BalanceSheetIncomeEntry,
  type InventoryBalanceSheetInput,
} from "./finance/balance-sheet-utils";
import type { BalanceSheetCashExpenseEntry } from "./finance/accrued-wages-utils";
import type {
  MonthEndCloseNetPayEntry,
  PayrollHistoryWagesEntry,
} from "./finance/accrued-wages-utils";
import type { CapitalContributionEntry } from "./finance/capital-contributions-utils";
import type {
  CashFlowIncomeEntry,
  ManualFinancialEntry,
} from "./finance/cash-flow-utils";
import { MONTH_LABELS } from "./finance/profit-loss-utils";
import {
  buildProfitLossReport,
  getEntryMonthIndex,
  type ProfitLossAssetEntry,
  type ProfitLossExpenseEntry,
  type ProfitLossIncomeEntry,
} from "./finance/profit-loss-utils";
import {
  formatPeriodLabel,
  getPeriodEndDate,
  getPeriodStartDate,
  getPeriodDisplayStatus,
  isMonthClosed,
  type MonthEndCloseRecord,
} from "./hr-payroll/payroll-period-utils";

export type DashboardIncomeEntry = {
  date: string;
  amount: number;
};

export type DashboardExpenseEntry = {
  date: string;
  amount: number;
};

export type DashboardPayrollProcessingEntry = {
  payroll_month: string;
  gross_pay: number;
};

export type DashboardPayrollHistoryEntry = {
  payroll_month: string;
  gross_pay: number;
};

export type DashboardPayrollPayableEntry = {
  vendor_name: string;
  status: string | null;
  amount: number;
  invoice_date: string;
  description: string | null;
};

export type DashboardMonthPoint = {
  year: number;
  month: number;
  label: string;
  shortLabel: string;
};

export type DashboardSummaryCards = {
  periodLabel: string;
  totalRevenue: number;
  totalRevenueYtd: number;
  totalExpenses: number;
  totalExpensesYtd: number;
  rawMaterialPurchases: number;
  rawMaterialPurchasesYtd: number;
  productPurchases: number;
  productPurchasesYtd: number;
  totalPurchases: number;
  totalPurchasesYtd: number;
  netProfit: number;
  netProfitYtd: number;
  ytdThroughLabel: string;
  cashPosition: number;
  balanceCheck: {
    isBalanced: boolean;
    difference: number;
  };
};

export type DashboardMonthOption = {
  key: string;
  year: number;
  month: number;
  label: string;
};

export type DashboardMonthSnapshot = {
  summary: DashboardSummaryCards;
  payroll: Omit<DashboardPayrollPanel, "payrollTrend">;
};

export type DashboardPayrollPanel = {
  periodLabel: string;
  lockStatus: string;
  totalPayrollCost: number;
  totalPayrollCostYtd: number;
  pendingPayrollLiabilities: number;
  liabilityReferenceLabel: string | null;
  payrollNotProcessed: boolean;
  payrollTrend: DashboardPayrollTrendPoint[];
};

export type DashboardViewModel = {
  defaultMonthKey: string;
  monthOptions: DashboardMonthOption[];
  monthSnapshots: Record<string, DashboardMonthSnapshot>;
  profitTrend: DashboardProfitTrendPoint[];
  cashTrend: DashboardCashTrendPoint[];
  payrollTrend: DashboardPayrollTrendPoint[];
  lowStockRawMaterialCount: number;
};

export type DashboardProfitTrendPoint = {
  label: string;
  revenue: number;
  expenses: number;
  netProfit: number;
};

export type DashboardCashTrendPoint = {
  label: string;
  cash: number;
};

export type DashboardPayrollTrendPoint = {
  label: string;
  payrollCost: number;
};

function createMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function getAvailableDashboardMonths(
  incomeEntries: Array<{ date: string }>,
  expenseEntries: Array<{ date: string }>,
  referenceDate = new Date(),
  purchaseEntries: Array<{ date: string }> = [],
): DashboardMonthOption[] {
  const { year: currentYear } = getCurrentCalendarMonth(referenceDate);
  const monthKeys = new Set<string>();

  for (let month = 1; month <= 12; month += 1) {
    monthKeys.add(createMonthKey(currentYear, month));
  }

  for (const entry of [...incomeEntries, ...expenseEntries, ...purchaseEntries]) {
    const date = entry.date.slice(0, 10);
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));

    if (year > 0 && month >= 1 && month <= 12) {
      monthKeys.add(createMonthKey(year, month));
    }
  }

  return [...monthKeys]
    .sort()
    .map((key) => {
      const [year, month] = key.split("-").map(Number);
      return {
        key,
        year,
        month,
        label: formatPeriodLabel(year, month),
      };
    });
}

function sumNetProfitYtd(
  report: ReturnType<typeof buildProfitLossReport>,
  throughMonthIndex: number,
): number {
  let total = 0;

  for (let monthIndex = 0; monthIndex <= throughMonthIndex; monthIndex += 1) {
    total += getProfitLossRowAmount(report, "net-profit", monthIndex);
  }

  return roundCurrency(total);
}

function sumRegisterAmountYtd(
  entries: Array<{ date: string; amount: number }>,
  year: number,
  throughMonth: number,
): number {
  return roundCurrency(
    entries.reduce((sum, entry) => {
      const monthIndex = getEntryMonthIndex(entry.date, year);
      if (monthIndex === null || monthIndex > throughMonth - 1) {
        return sum;
      }

      return sum + (Number(entry.amount) || 0);
    }, 0),
  );
}

function sumPurchaseAmountForMonth(
  entries: Array<{ purchase_date: string; total_cost: number }>,
  year: number,
  month: number,
): number {
  return roundCurrency(
    entries.reduce((sum, entry) => {
      const monthIndex = getEntryMonthIndex(entry.purchase_date, year);
      if (monthIndex !== month - 1) {
        return sum;
      }

      return sum + (Number(entry.total_cost) || 0);
    }, 0),
  );
}

function sumPurchaseAmountYtd(
  entries: Array<{ purchase_date: string; total_cost: number }>,
  year: number,
  throughMonth: number,
): number {
  return roundCurrency(
    entries.reduce((sum, entry) => {
      const monthIndex = getEntryMonthIndex(entry.purchase_date, year);
      if (monthIndex === null || monthIndex > throughMonth - 1) {
        return sum;
      }

      return sum + (Number(entry.total_cost) || 0);
    }, 0),
  );
}

function buildYtdThroughLabel(year: number, throughMonth: number): string {
  if (throughMonth <= 1) {
    return formatPeriodLabel(year, 1);
  }

  return `Jan – ${formatPeriodLabel(year, throughMonth)}`;
}

function buildMonthSnapshot(input: {
  incomeEntries: DashboardIncomeEntry[];
  profitLossIncomeEntries: ProfitLossIncomeEntry[];
  balanceSheetIncomeEntries: BalanceSheetIncomeEntry[];
  expenseEntries: DashboardExpenseEntry[];
  profitLossExpenseEntries: ProfitLossExpenseEntry[];
  fixedAssets: ProfitLossAssetEntry[];
  payableEntries: BalanceSheetAccountsPayableEntry[];
  capitalContributions: CapitalContributionEntry[];
  cashFlowIncomeEntries: CashFlowIncomeEntry[];
  cashFlowExpenseEntries: BalanceSheetCashExpenseEntry[];
  payrollHistoryWages: PayrollHistoryWagesEntry[];
  monthEndCloseNetPay: MonthEndCloseNetPayEntry[];
  manualEntries: ManualFinancialEntry[];
  monthEndCloseRecords: MonthEndCloseRecord[];
  payrollProcessingEntries: DashboardPayrollProcessingEntry[];
  payrollHistoryEntries: DashboardPayrollHistoryEntry[];
  payrollPayables: DashboardPayrollPayableEntry[];
  inventoryBalanceSheetInput: InventoryBalanceSheetInput;
  year: number;
  month: number;
  referenceDate?: Date;
}): DashboardMonthSnapshot {
  const monthIndex = input.month - 1;
  const periodLabel = formatPeriodLabel(input.year, input.month);
  const profitLossReport = buildProfitLossReport(
    input.profitLossIncomeEntries,
    input.profitLossExpenseEntries,
    input.fixedAssets,
    input.year,
  );
  const balanceSheetReport = buildBalanceSheetReportForYear(
    input.balanceSheetIncomeEntries,
    input.profitLossExpenseEntries,
    input.fixedAssets,
    input.payableEntries,
    input.capitalContributions,
    input.cashFlowExpenseEntries,
    input.payrollHistoryWages,
    input.monthEndCloseNetPay,
    input.year,
    input.inventoryBalanceSheetInput,
    input.referenceDate,
    input.manualEntries,
  );
  const balanceCheck = getBalanceCheckForPeriod(balanceSheetReport, monthIndex);
  const cashRow = balanceSheetReport.rows.find((row) => row.key === "cash");
  const closeRecord = getCurrentMonthCloseRecord(
    input.monthEndCloseRecords,
    input.year,
    input.month,
  );
  const payrollMonth = getPeriodStartDate(input.year, input.month);
  const hasPayrollActivity = monthHasPayrollActivity(
    payrollMonth,
    input.payrollProcessingEntries,
    input.payrollHistoryEntries,
  );
  const payrollNotProcessed =
    !isMonthClosed(closeRecord) && !hasPayrollActivity;
  const rawMaterialPurchases = sumPurchaseAmountForMonth(
    input.inventoryBalanceSheetInput.cashPurchases,
    input.year,
    input.month,
  );
  const rawMaterialPurchasesYtd = sumPurchaseAmountYtd(
    input.inventoryBalanceSheetInput.cashPurchases,
    input.year,
    input.month,
  );
  const productPurchases = sumPurchaseAmountForMonth(
    input.inventoryBalanceSheetInput.productCashPurchases,
    input.year,
    input.month,
  );
  const productPurchasesYtd = sumPurchaseAmountYtd(
    input.inventoryBalanceSheetInput.productCashPurchases,
    input.year,
    input.month,
  );

  return {
    summary: {
      periodLabel,
      totalRevenue: sumRegisterAmountForMonth(
        input.incomeEntries,
        input.year,
        input.month,
      ),
      totalRevenueYtd: sumRegisterAmountYtd(
        input.incomeEntries,
        input.year,
        input.month,
      ),
      totalExpenses: sumRegisterAmountForMonth(
        input.expenseEntries,
        input.year,
        input.month,
      ),
      totalExpensesYtd: sumRegisterAmountYtd(
        input.expenseEntries,
        input.year,
        input.month,
      ),
      rawMaterialPurchases,
      rawMaterialPurchasesYtd,
      productPurchases,
      productPurchasesYtd,
      totalPurchases: roundCurrency(
        rawMaterialPurchases + productPurchases,
      ),
      totalPurchasesYtd: roundCurrency(
        rawMaterialPurchasesYtd + productPurchasesYtd,
      ),
      netProfit: getProfitLossRowAmount(
        profitLossReport,
        "net-profit",
        monthIndex,
      ),
      netProfitYtd: sumNetProfitYtd(profitLossReport, monthIndex),
      ytdThroughLabel: buildYtdThroughLabel(input.year, input.month),
      cashPosition: cashRow?.amounts[monthIndex] ?? 0,
      balanceCheck: {
        isBalanced: balanceCheck.isBalanced,
        difference: balanceCheck.difference,
      },
    },
    payroll: {
      periodLabel,
      lockStatus: getPeriodDisplayStatus(closeRecord, hasPayrollActivity),
      totalPayrollCost: sumPayrollGrossForMonth(
        payrollMonth,
        input.payrollProcessingEntries,
        input.payrollHistoryEntries,
        closeRecord,
      ),
      totalPayrollCostYtd: sumPayrollGrossYtd({
        year: input.year,
        throughMonth: input.month,
        processingEntries: input.payrollProcessingEntries,
        historyEntries: input.payrollHistoryEntries,
        monthEndCloseRecords: input.monthEndCloseRecords,
      }),
      pendingPayrollLiabilities: isMonthClosed(closeRecord)
        ? sumPendingPayrollLiabilities(input.payrollPayables, payrollMonth)
        : 0,
      liabilityReferenceLabel: isMonthClosed(closeRecord) ? periodLabel : null,
      payrollNotProcessed,
    },
  };
}

export function getCurrentCalendarMonth(referenceDate = new Date()): {
  year: number;
  month: number;
} {
  return {
    year: referenceDate.getFullYear(),
    month: referenceDate.getMonth() + 1,
  };
}

export function getLastSixCalendarMonths(
  referenceDate = new Date(),
): DashboardMonthPoint[] {
  const points: DashboardMonthPoint[] = [];

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth() - offset,
      1,
    );
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    points.push({
      year,
      month,
      label: formatPeriodLabel(year, month),
      shortLabel: `${MONTH_LABELS[month - 1]} ${String(year).slice(-2)}`,
    });
  }

  return points;
}

function sumRegisterAmountForMonth(
  entries: Array<{ date: string; amount: number }>,
  year: number,
  month: number,
): number {
  return roundCurrency(
    entries.reduce((sum, entry) => {
      const monthIndex = getEntryMonthIndex(entry.date, year);
      if (monthIndex !== month - 1) {
        return sum;
      }

      return sum + (Number(entry.amount) || 0);
    }, 0),
  );
}

function getProfitLossRowAmount(
  report: ReturnType<typeof buildProfitLossReport>,
  rowKey: string,
  monthIndex: number,
): number {
  const row = report.rows.find((entry) => entry.key === rowKey);
  return row?.amounts[monthIndex] ?? 0;
}

function buildBalanceSheetReportForYear(
  incomeEntries: BalanceSheetIncomeEntry[],
  expenseEntries: ProfitLossExpenseEntry[],
  fixedAssets: ProfitLossAssetEntry[],
  payableEntries: BalanceSheetAccountsPayableEntry[],
  capitalContributions: CapitalContributionEntry[],
  cashFlowExpenseEntries: BalanceSheetCashExpenseEntry[],
  payrollHistory: PayrollHistoryWagesEntry[],
  monthEndCloseNetPay: MonthEndCloseNetPayEntry[],
  financialYear: number,
  inventoryBalanceSheetInput: InventoryBalanceSheetInput,
  referenceDate?: Date,
  manualEntries: ManualFinancialEntry[] = [],
) {
  return buildBalanceSheetReport(
    incomeEntries,
    expenseEntries,
    fixedAssets,
    payableEntries,
    capitalContributions,
    cashFlowExpenseEntries,
    payrollHistory,
    monthEndCloseNetPay,
    financialYear,
    {
      ...inventoryBalanceSheetInput,
      referenceDate,
    },
    manualEntries,
  );
}

function sumPayrollGrossForMonth(
  payrollMonth: string,
  processingEntries: DashboardPayrollProcessingEntry[],
  historyEntries: DashboardPayrollHistoryEntry[],
  closeRecord: MonthEndCloseRecord | null | undefined,
): number {
  const normalizedMonth = payrollMonth.slice(0, 10);

  if (isMonthClosed(closeRecord)) {
    return roundCurrency(
      historyEntries
        .filter((entry) => entry.payroll_month.slice(0, 10) === normalizedMonth)
        .reduce((sum, entry) => sum + (Number(entry.gross_pay) || 0), 0),
    );
  }

  return roundCurrency(
    processingEntries
      .filter((entry) => entry.payroll_month.slice(0, 10) === normalizedMonth)
      .reduce((sum, entry) => sum + (Number(entry.gross_pay) || 0), 0),
  );
}

function sumPayrollGrossYtd(input: {
  year: number;
  throughMonth: number;
  processingEntries: DashboardPayrollProcessingEntry[];
  historyEntries: DashboardPayrollHistoryEntry[];
  monthEndCloseRecords: MonthEndCloseRecord[];
}): number {
  let total = 0;

  for (let month = 1; month <= input.throughMonth; month += 1) {
    const payrollMonth = getPeriodStartDate(input.year, month);
    const closeRecord = getCurrentMonthCloseRecord(
      input.monthEndCloseRecords,
      input.year,
      month,
    );

    total += sumPayrollGrossForMonth(
      payrollMonth,
      input.processingEntries,
      input.historyEntries,
      closeRecord,
    );
  }

  return roundCurrency(total);
}

function sumPendingPayrollLiabilities(
  payables: DashboardPayrollPayableEntry[],
  payrollMonth: string,
): number {
  const periodEnd = getPeriodEndDate(
    Number(payrollMonth.slice(0, 4)),
    Number(payrollMonth.slice(5, 7)),
  );
  const monthLabel = formatPeriodLabel(
    Number(payrollMonth.slice(0, 4)),
    Number(payrollMonth.slice(5, 7)),
  );

  return roundCurrency(
    payables.reduce((sum, payable) => {
      const vendor = payable.vendor_name?.trim();
      if (vendor !== "SSNIT" && vendor !== "GRA") {
        return sum;
      }

      if ((payable.status ?? "").trim() !== "Unpaid") {
        return sum;
      }

      const invoiceDate = payable.invoice_date.slice(0, 10);
      const description = payable.description ?? "";
      const matchesMonth =
        invoiceDate === periodEnd || description.includes(monthLabel);

      if (!matchesMonth) {
        return sum;
      }

      return sum + (Number(payable.amount) || 0);
    }, 0),
  );
}

function getCurrentMonthCloseRecord(
  monthEndCloseRecords: MonthEndCloseRecord[],
  year: number,
  month: number,
): MonthEndCloseRecord | null {
  const payrollMonth = getPeriodStartDate(year, month);
  return (
    monthEndCloseRecords.find(
      (record) => record.month.slice(0, 10) === payrollMonth,
    ) ?? null
  );
}

function monthHasPayrollActivity(
  payrollMonth: string,
  processingEntries: DashboardPayrollProcessingEntry[],
  historyEntries: DashboardPayrollHistoryEntry[],
): boolean {
  const normalizedMonth = payrollMonth.slice(0, 10);

  return (
    processingEntries.some(
      (entry) => entry.payroll_month.slice(0, 10) === normalizedMonth,
    ) ||
    historyEntries.some(
      (entry) => entry.payroll_month.slice(0, 10) === normalizedMonth,
    )
  );
}

export function buildDashboardViewModel(input: {
  incomeEntries: DashboardIncomeEntry[];
  profitLossIncomeEntries: ProfitLossIncomeEntry[];
  balanceSheetIncomeEntries: BalanceSheetIncomeEntry[];
  expenseEntries: DashboardExpenseEntry[];
  profitLossExpenseEntries: ProfitLossExpenseEntry[];
  fixedAssets: ProfitLossAssetEntry[];
  payableEntries: BalanceSheetAccountsPayableEntry[];
  capitalContributions: CapitalContributionEntry[];
  cashFlowIncomeEntries: CashFlowIncomeEntry[];
  cashFlowExpenseEntries: BalanceSheetCashExpenseEntry[];
  payrollHistoryWages: PayrollHistoryWagesEntry[];
  monthEndCloseNetPay: MonthEndCloseNetPayEntry[];
  manualEntries: ManualFinancialEntry[];
  monthEndCloseRecords: MonthEndCloseRecord[];
  payrollProcessingEntries: DashboardPayrollProcessingEntry[];
  payrollHistoryEntries: DashboardPayrollHistoryEntry[];
  payrollPayables: DashboardPayrollPayableEntry[];
  inventoryBalanceSheetInput: InventoryBalanceSheetInput;
  lowStockRawMaterialCount?: number;
  referenceDate?: Date;
}): DashboardViewModel {
  const referenceDate = input.referenceDate ?? new Date();
  const { year: currentYear, month: currentMonth } =
    getCurrentCalendarMonth(referenceDate);
  const defaultMonthKey = createMonthKey(currentYear, currentMonth);
  const monthOptions = getAvailableDashboardMonths(
    input.incomeEntries,
    input.expenseEntries,
    referenceDate,
    [
      ...input.inventoryBalanceSheetInput.cashPurchases.map((entry) => ({
        date: entry.purchase_date,
      })),
      ...input.inventoryBalanceSheetInput.productCashPurchases.map((entry) => ({
        date: entry.purchase_date,
      })),
    ],
  );
  const trendMonths = getLastSixCalendarMonths(referenceDate);
  const monthSnapshots: Record<string, DashboardMonthSnapshot> = {};

  for (const option of monthOptions) {
    monthSnapshots[option.key] = buildMonthSnapshot({
      ...input,
      year: option.year,
      month: option.month,
    });
  }

  const profitTrend = trendMonths.map((point) => {
    const monthIndex = point.month - 1;
    const report = buildProfitLossReport(
      input.profitLossIncomeEntries,
      input.profitLossExpenseEntries,
      input.fixedAssets,
      point.year,
    );

    return {
      label: point.shortLabel,
      revenue: getProfitLossRowAmount(report, "total-revenue", monthIndex),
      expenses: getProfitLossRowAmount(report, "total-expenses", monthIndex),
      netProfit: getProfitLossRowAmount(report, "net-profit", monthIndex),
    };
  });

  const cashTrend = trendMonths.map((point) => {
    const monthIndex = point.month - 1;
    const report = buildBalanceSheetReportForYear(
      input.balanceSheetIncomeEntries,
      input.profitLossExpenseEntries,
      input.fixedAssets,
      input.payableEntries,
      input.capitalContributions,
      input.cashFlowExpenseEntries,
      input.payrollHistoryWages,
      input.monthEndCloseNetPay,
      point.year,
      input.inventoryBalanceSheetInput,
      referenceDate,
      input.manualEntries,
    );
    const cashAmounts = report.rows.find((row) => row.key === "cash")?.amounts;

    return {
      label: point.shortLabel,
      cash: cashAmounts?.[monthIndex] ?? 0,
    };
  });

  const payrollTrend = trendMonths.map((point) => {
    const payrollMonth = getPeriodStartDate(point.year, point.month);
    const closeRecord = getCurrentMonthCloseRecord(
      input.monthEndCloseRecords,
      point.year,
      point.month,
    );

    return {
      label: point.shortLabel,
      payrollCost: sumPayrollGrossForMonth(
        payrollMonth,
        input.payrollProcessingEntries,
        input.payrollHistoryEntries,
        closeRecord,
      ),
    };
  });

  return {
    defaultMonthKey,
    monthOptions,
    monthSnapshots,
    profitTrend,
    cashTrend,
    payrollTrend,
    lowStockRawMaterialCount: input.lowStockRawMaterialCount ?? 0,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
