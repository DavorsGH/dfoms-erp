import {
  getAvailableDashboardMonths,
  getCurrentCalendarMonth,
  type DashboardMonthOption,
} from "@/app/dashboard/dashboard-utils";
import { formatPeriodLabel } from "@/app/dashboard/hr-payroll/payroll-period-utils";
import { getEntryMonthIndex } from "@/app/dashboard/finance/profit-loss-utils";

export type LandlordPortalFinancialMonthSummary = {
  periodLabel: string;
  ytdThroughLabel: string;
  totalRevenue: number;
  totalRevenueYtd: number;
  totalExpenses: number;
  totalExpensesYtd: number;
  netProfit: number;
  netProfitYtd: number;
};

export type LandlordPortalFinancialSummaryViewModel = {
  defaultMonthKey: string;
  monthOptions: DashboardMonthOption[];
  monthSnapshots: Record<string, LandlordPortalFinancialMonthSummary>;
};

export type LandlordPortalFinancialAmountEntry = {
  date: string;
  amount: number;
};

function createMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildYtdThroughLabel(year: number, throughMonth: number): string {
  if (throughMonth <= 1) {
    return formatPeriodLabel(year, 1);
  }

  return `Jan – ${formatPeriodLabel(year, throughMonth)}`;
}

function sumAmountForMonth(
  entries: LandlordPortalFinancialAmountEntry[],
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

function sumAmountYtd(
  entries: LandlordPortalFinancialAmountEntry[],
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

function buildMonthSummary(
  revenueEntries: LandlordPortalFinancialAmountEntry[],
  expenseEntries: LandlordPortalFinancialAmountEntry[],
  year: number,
  month: number,
): LandlordPortalFinancialMonthSummary {
  const totalRevenue = sumAmountForMonth(revenueEntries, year, month);
  const totalRevenueYtd = sumAmountYtd(revenueEntries, year, month);
  const totalExpenses = sumAmountForMonth(expenseEntries, year, month);
  const totalExpensesYtd = sumAmountYtd(expenseEntries, year, month);

  return {
    periodLabel: formatPeriodLabel(year, month),
    ytdThroughLabel: buildYtdThroughLabel(year, month),
    totalRevenue,
    totalRevenueYtd,
    totalExpenses,
    totalExpensesYtd,
    netProfit: roundCurrency(totalRevenue - totalExpenses),
    netProfitYtd: roundCurrency(totalRevenueYtd - totalExpensesYtd),
  };
}

/**
 * Landlord portfolio financial summary (staff Dashboard card convention).
 *
 * Calculation mapping vs staff Finance dashboard:
 * - Revenue  = rent_ledger.amount_paid_ghs dated by payment_date
 *              (staff: income register / P&L total revenue)
 * - Expenses = property_expenses.amount_ghs dated by expense_date
 *              (staff: expense register / P&L total expenses)
 * - Net      = Revenue − Expenses
 *              (staff: P&L net profit; landlord uses cash-collected − expenses)
 */
export function buildLandlordPortalFinancialSummary(input: {
  revenueEntries: LandlordPortalFinancialAmountEntry[];
  expenseEntries: LandlordPortalFinancialAmountEntry[];
  referenceDate?: Date;
}): LandlordPortalFinancialSummaryViewModel {
  const referenceDate = input.referenceDate ?? new Date();
  const { year: currentYear, month: currentMonth } =
    getCurrentCalendarMonth(referenceDate);
  const defaultMonthKey = createMonthKey(currentYear, currentMonth);
  const monthOptions = getAvailableDashboardMonths(
    input.revenueEntries,
    input.expenseEntries,
    referenceDate,
  );
  const monthSnapshots: Record<string, LandlordPortalFinancialMonthSummary> =
    {};

  for (const option of monthOptions) {
    monthSnapshots[option.key] = buildMonthSummary(
      input.revenueEntries,
      input.expenseEntries,
      option.year,
      option.month,
    );
  }

  if (!monthSnapshots[defaultMonthKey]) {
    monthSnapshots[defaultMonthKey] = buildMonthSummary(
      input.revenueEntries,
      input.expenseEntries,
      currentYear,
      currentMonth,
    );
  }

  return {
    defaultMonthKey,
    monthOptions,
    monthSnapshots,
  };
}
