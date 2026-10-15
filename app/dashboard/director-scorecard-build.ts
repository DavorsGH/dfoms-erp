import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardPageData } from "@/app/dashboard/dashboard-page-data";
import {
  buildDashboardBudgetStatusSnapshot,
  type BudgetVsActualReportData,
} from "@/app/dashboard/dashboard-budget-status-utils";
import type { DashboardViewModel } from "@/app/dashboard/dashboard-utils";
import { shouldIncludeExpenseInNonCashTotals } from "@/app/dashboard/finance/customer-refund-expense-utils";
import { getPeriodStartDate } from "@/app/dashboard/hr-payroll/payroll-period-utils";
import {
  buildProfitLossReport,
  type ProfitLossReport,
} from "@/app/dashboard/finance/profit-loss-utils";
import {
  ALL_PROJECTS_FILTER,
  buildBudgetVsActualReport,
  type BudgetVsActualRow,
} from "@/app/dashboard/reports/budget-vs-actual-utils";
import { monthIndexFromMonthNumber } from "@/app/dashboard/reports/finance-reports-utils";
import {
  defaultDueRulesPartial,
  listStatutoryPeriodObligations,
  OBLIGATION_KIND_LABELS,
  type TaxSettingsDueRules,
} from "@/app/dashboard/finance/statutory-due-rules";
import type { TaxLedgerBalanceSource } from "@/app/dashboard/finance/tax-ledger-utils";
import {
  DIRECTOR_SCORECARD_CIT_RATE,
  DIRECTOR_SCORECARD_DIVIDEND_WHT_RATE,
  DIRECTOR_SCORECARD_GSL_RATE,
  DIRECTOR_SCORECARD_OWNERS_SHARE,
  DIRECTOR_SCORECARD_REINVEST_SHARE,
  DIRECTOR_SCORECARD_RESERVE_SHARE,
} from "@/lib/finance/director-scorecard-constants";

export type DirectorScorecardChecklistItem = {
  id: string;
  label: string;
  pass: boolean;
  reason: string;
};

export type DirectorScorecardSnapshot = {
  periodLabel: string;
  year: number;
  month: number;
  revenue: number;
  totalCosts: number;
  profitBeforeTax: number;
  taxToSetAside: number;
  taxDetail: {
    citAmount: number;
    gslAmount: number;
    whtCreditApplied: number;
  };
  profitAfterTax: number;
  reserveAmount: number;
  reinvestAmount: number;
  ownersShareAmount: number;
  dividendQuarter: {
    quarterLabel: string;
    gross: number;
    wht: number;
    net: number;
  };
  budget: {
    hasBudgetLines: boolean;
    periodLabel: string;
    rows: BudgetVsActualRow[];
  };
  checklist: {
    ready: boolean;
    items: DirectorScorecardChecklistItem[];
  };
};

export type DirectorScorecardClientInvoiceRow = {
  invoice_number: string;
  invoice_date: string;
  status: string;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function readProfitLossRowAmount(
  report: ProfitLossReport,
  rowKey: string,
  monthIndex: number,
): number {
  const row = report.rows.find((entry) => entry.key === rowKey);
  return row?.amounts[monthIndex] ?? 0;
}

function sumClientWhtReceivableForMonth(
  entries: TaxLedgerBalanceSource[],
  year: number,
  month: number,
): number {
  const periodKey = getPeriodStartDate(year, month).slice(0, 10);
  return roundCurrency(
    entries
      .filter(
        (entry) =>
          entry.direction === "wht_receivable" &&
          entry.tax_component === "wht" &&
          (entry.period_month ?? "").slice(0, 10) === periodKey,
      )
      .reduce((sum, entry) => sum + (Number(entry.tax_amount) || 0), 0),
  );
}

function computeTaxToSetAside(
  profitBeforeTax: number,
  whtReceivableAccrued: number,
): {
  citAmount: number;
  gslAmount: number;
  whtCreditApplied: number;
  taxToSetAside: number;
} {
  if (profitBeforeTax <= 0) {
    return {
      citAmount: 0,
      gslAmount: 0,
      whtCreditApplied: 0,
      taxToSetAside: 0,
    };
  }

  const citAmount = roundCurrency(profitBeforeTax * DIRECTOR_SCORECARD_CIT_RATE);
  const gslAmount = roundCurrency(profitBeforeTax * DIRECTOR_SCORECARD_GSL_RATE);
  const whtCreditApplied = roundCurrency(
    Math.min(whtReceivableAccrued, citAmount),
  );
  const taxToSetAside = roundCurrency(
    Math.max(citAmount - whtCreditApplied, 0) + gslAmount,
  );

  return { citAmount, gslAmount, whtCreditApplied, taxToSetAside };
}

/** PAT = PBT − CIT − GSL (WHT credit does not reduce PAT; it reduces tax set-aside only). */
function computeProfitAfterTax(
  profitBeforeTax: number,
  citAmount: number,
  gslAmount: number,
): number {
  if (profitBeforeTax <= 0) {
    return roundCurrency(profitBeforeTax);
  }
  return roundCurrency(profitBeforeTax - citAmount - gslAmount);
}

function monthPatForScorecard(
  profitBeforeTax: number,
  whtReceivableAccrued: number,
): {
  taxDetail: ReturnType<typeof computeTaxToSetAside>;
  profitAfterTax: number;
} {
  const taxDetail = computeTaxToSetAside(profitBeforeTax, whtReceivableAccrued);
  const profitAfterTax = computeProfitAfterTax(
    profitBeforeTax,
    taxDetail.citAmount,
    taxDetail.gslAmount,
  );
  return { taxDetail, profitAfterTax };
}

function quarterStartMonth(calendarMonth: number): number {
  return Math.floor((calendarMonth - 1) / 3) * 3 + 1;
}

function quarterLabel(year: number, throughMonth: number): string {
  const start = quarterStartMonth(throughMonth);
  const end = start + 2;
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${names[start - 1]}–${names[end - 1]} ${year}`;
}

function endOfMonthIso(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

function quarterStartIso(year: number, month: number): string {
  const startMonth = quarterStartMonth(month);
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}

function invoiceInQuarterThroughMonth(
  invoiceDate: string,
  year: number,
  month: number,
): boolean {
  const date = invoiceDate.slice(0, 10);
  const start = quarterStartIso(year, month);
  const end = endOfMonthIso(year, month);
  return date >= start && date <= end;
}

function buildProfitLossReportsByYear(
  dashboardPageData: DashboardPageData,
  years: number[],
): Map<number, ProfitLossReport> {
  const {
    initialIncomeEntries: incomeEntries,
    initialExpenseEntries: expenseEntries,
    initialFixedAssets: fixedAssets,
  } = dashboardPageData;

  const profitLossIncomeEntries =
    incomeEntries?.map((entry) => {
      const row = entry as typeof entry & {
        net_of_tax_amount?: number | null;
        output_vat_amount?: number | null;
      };
      return {
        date: row.date,
        service_category: row.service_category,
        amount: row.amount,
        entry_type: row.entry_type,
        sale_status: row.sale_status,
        net_of_tax_amount: row.net_of_tax_amount,
        output_vat_amount: row.output_vat_amount,
      };
    }) ?? [];

  const profitLossExpenseEntries =
    expenseEntries?.filter((entry) =>
      shouldIncludeExpenseInNonCashTotals(entry),
    ) ?? [];

  const map = new Map<number, ProfitLossReport>();
  for (const year of years) {
    map.set(
      year,
      buildProfitLossReport(
        profitLossIncomeEntries,
        profitLossExpenseEntries,
        fixedAssets ?? [],
        year,
      ),
    );
  }
  return map;
}

function taxLedgerSources(
  dashboardPageData: DashboardPageData,
): TaxLedgerBalanceSource[] {
  return (dashboardPageData.initialTaxLedgerEntries ?? []).map((entry) => {
    const row = entry as typeof entry & { period_month?: string | null };
    return {
      status: row.status,
      period_month: (row.period_month ?? "").slice(0, 10),
      tax_amount: Number(row.tax_amount) || 0,
      direction: row.direction,
      tax_component: row.tax_component,
    };
  });
}

function buildChecklist(input: {
  year: number;
  month: number;
  clientInvoices: DirectorScorecardClientInvoiceRow[];
  taxLedgerSources: TaxLedgerBalanceSource[];
  taxSettings: TaxSettingsDueRules;
  cashPosition: number;
  payrollCost: number;
  balanceCheckBalanced: boolean;
  grossDividend: number;
  taxToSetAside: number;
  todayIso: string;
}): { ready: boolean; items: DirectorScorecardChecklistItem[] } {
  const unpaidInvoices = input.clientInvoices.filter((invoice) => {
    if (invoice.status === "draft" || invoice.status === "voided") {
      return false;
    }
    if (!invoiceInQuarterThroughMonth(invoice.invoice_date, input.year, input.month)) {
      return false;
    }
    return invoice.status !== "paid";
  });

  const invoicesPass = unpaidInvoices.length === 0;
  const invoicesReason = invoicesPass
    ? "All quarter invoices through this month are paid."
    : `Unpaid: ${unpaidInvoices.map((row) => row.invoice_number).join(", ")}.`;

  const obligations = listStatutoryPeriodObligations({
    entries: input.taxLedgerSources,
    settings: input.taxSettings,
    todayIso: input.todayIso,
  });
  const overdue = obligations.filter(
    (row) => row.isOverdue && (row.openAmount ?? 0) > 0.005,
  );
  const statutoryPass = overdue.length === 0;
  const statutoryReason = statutoryPass
    ? "No overdue open statutory obligations."
    : overdue
        .map(
          (row) =>
            `${OBLIGATION_KIND_LABELS[row.kind]} ${row.periodMonth.slice(0, 7)} (due ${row.dueDate})`,
        )
        .join("; ");

  const cashReservePass = input.cashPosition >= input.payrollCost - 0.005;
  const cashReserveReason = cashReservePass
    ? "Cash meets or exceeds one month of payroll."
    : `Cash ${roundCurrency(input.cashPosition)} is below payroll ${roundCurrency(input.payrollCost)}.`;

  const balancePass = input.balanceCheckBalanced;
  const balanceReason = balancePass
    ? "Balance sheet check is balanced."
    : "Balance sheet is out of balance for this month.";

  const cashAfterDividend =
    input.cashPosition - input.grossDividend - input.taxToSetAside;
  const dividendCashPass =
    cashAfterDividend >= input.payrollCost - 0.005;
  const dividendCashReason = dividendCashPass
    ? "Cash after gross dividend and tax set-aside still covers payroll."
    : `After dividend and tax set-aside, cash ${roundCurrency(cashAfterDividend)} is below payroll ${roundCurrency(input.payrollCost)}.`;

  const items: DirectorScorecardChecklistItem[] = [
    {
      id: "client-invoices",
      label: "Client invoices paid",
      pass: invoicesPass,
      reason: invoicesReason,
    },
    {
      id: "statutory",
      label: "Statutory payments up to date",
      pass: statutoryPass,
      reason: statutoryReason,
    },
    {
      id: "cash-reserve",
      label: "Cash reserve covers one month of payroll",
      pass: cashReservePass,
      reason: cashReserveReason,
    },
    {
      id: "balance-sheet",
      label: "Balance Sheet balanced",
      pass: balancePass,
      reason: balanceReason,
    },
    {
      id: "dividend-cash",
      label: "Cash after dividend covers next payroll",
      pass: dividendCashPass,
      reason: dividendCashReason,
    },
  ];

  return {
    ready: items.every((item) => item.pass),
    items,
  };
}

function computeQuarterDividend(
  viewModel: DashboardViewModel,
  profitLossByYear: Map<number, ProfitLossReport>,
  taxSources: TaxLedgerBalanceSource[],
  year: number,
  throughMonth: number,
): { gross: number; wht: number; net: number; quarterLabel: string } {
  const startMonth = quarterStartMonth(throughMonth);
  let quarterPatSum = 0;

  for (let month = startMonth; month <= throughMonth; month += 1) {
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const option = viewModel.monthOptions.find((row) => row.key === monthKey);
    if (!option) {
      continue;
    }

    const report = profitLossByYear.get(option.year);
    if (!report) {
      continue;
    }

    const monthIndex = month - 1;
    const pbt = readProfitLossRowAmount(report, "net-profit", monthIndex);
    const whtAccrued = sumClientWhtReceivableForMonth(
      taxSources,
      option.year,
      option.month,
    );
    const { profitAfterTax } = monthPatForScorecard(pbt, whtAccrued);
    quarterPatSum += profitAfterTax;
  }

  const gross = roundCurrency(
    Math.max(0, quarterPatSum) * DIRECTOR_SCORECARD_OWNERS_SHARE,
  );
  const wht = roundCurrency(gross * DIRECTOR_SCORECARD_DIVIDEND_WHT_RATE);
  const net = roundCurrency(gross - wht);

  return {
    gross,
    wht,
    net,
    quarterLabel: quarterLabel(year, throughMonth),
  };
}

export function buildDirectorScorecardByMonthKey(input: {
  viewModel: DashboardViewModel;
  dashboardPageData: DashboardPageData;
  budgetReportData: BudgetVsActualReportData;
  clientInvoices: DirectorScorecardClientInvoiceRow[];
  taxSettings: TaxSettingsDueRules | null;
  todayIso?: string;
}): Record<string, DirectorScorecardSnapshot> {
  const todayIso = input.todayIso ?? new Date().toISOString().slice(0, 10);
  const taxSettings: TaxSettingsDueRules = {
    vat_return_period: input.taxSettings?.vat_return_period ?? "monthly",
    ...defaultDueRulesPartial(),
    ...(input.taxSettings ?? {}),
  };
  const taxSources = taxLedgerSources(input.dashboardPageData);
  const years = [
    ...new Set(input.viewModel.monthOptions.map((option) => option.year)),
  ];
  const profitLossByYear = buildProfitLossReportsByYear(
    input.dashboardPageData,
    years,
  );

  const snapshots: Record<string, DirectorScorecardSnapshot> = {};

  for (const option of input.viewModel.monthOptions) {
    const monthSnapshot = input.viewModel.monthSnapshots[option.key];
    if (!monthSnapshot) {
      continue;
    }

    const report = profitLossByYear.get(option.year);
    const monthIndex = option.month - 1;
    const revenue = report
      ? readProfitLossRowAmount(report, "total-revenue", monthIndex)
      : 0;
    const totalCosts = report
      ? readProfitLossRowAmount(report, "total-expenses", monthIndex)
      : 0;
    const profitBeforeTax = monthSnapshot.summary.netProfit;
    const whtAccrued = sumClientWhtReceivableForMonth(
      taxSources,
      option.year,
      option.month,
    );
    const { taxDetail, profitAfterTax } = monthPatForScorecard(
      profitBeforeTax,
      whtAccrued,
    );
    const splitBase = Math.max(0, profitAfterTax);
    const reserveAmount = roundCurrency(
      splitBase * DIRECTOR_SCORECARD_RESERVE_SHARE,
    );
    const reinvestAmount = roundCurrency(
      splitBase * DIRECTOR_SCORECARD_REINVEST_SHARE,
    );
    const ownersShareAmount = roundCurrency(
      splitBase * DIRECTOR_SCORECARD_OWNERS_SHARE,
    );

    const dividendQuarter = computeQuarterDividend(
      input.viewModel,
      profitLossByYear,
      taxSources,
      option.year,
      option.month,
    );

    const budgetStatus = buildDashboardBudgetStatusSnapshot(
      input.budgetReportData,
      option.year,
      option.month,
      option.label,
    );
    const budgetRows = buildBudgetVsActualReport({
      budgets: input.budgetReportData.initialBudgets,
      expenses: input.budgetReportData.initialExpenses,
      rawMaterialPurchases: input.budgetReportData.initialRawMaterialPurchases,
      productPurchases: input.budgetReportData.initialProductPurchases,
      payrollRows: input.budgetReportData.initialPayrollRows,
      projects: input.budgetReportData.initialProjects,
      year: option.year,
      month: option.month,
      monthIndex: monthIndexFromMonthNumber(option.month),
      projectFilter: ALL_PROJECTS_FILTER,
      viewMode: "monthly-prorated",
    });

    const checklist = buildChecklist({
      year: option.year,
      month: option.month,
      clientInvoices: input.clientInvoices,
      taxLedgerSources: taxSources,
      taxSettings,
      cashPosition: monthSnapshot.summary.cashPosition,
      payrollCost: monthSnapshot.payroll.totalPayrollCost,
      balanceCheckBalanced: monthSnapshot.summary.balanceCheck.isBalanced,
      grossDividend: dividendQuarter.gross,
      taxToSetAside: taxDetail.taxToSetAside,
      todayIso,
    });

    snapshots[option.key] = {
      periodLabel: option.label,
      year: option.year,
      month: option.month,
      revenue,
      totalCosts,
      profitBeforeTax,
      taxToSetAside: taxDetail.taxToSetAside,
      taxDetail,
      profitAfterTax,
      reserveAmount,
      reinvestAmount,
      ownersShareAmount,
      dividendQuarter,
      budget: {
        hasBudgetLines: budgetStatus.month.hasBudgetLines,
        periodLabel: option.label,
        rows: budgetRows,
      },
      checklist,
    };
  }

  return snapshots;
}

export function mergeTaxSettingsDueRules(
  row: Record<string, unknown> | null,
): TaxSettingsDueRules {
  return {
    vat_return_period:
      row?.vat_return_period === "quarterly" ? "quarterly" : "monthly",
    ...defaultDueRulesPartial(),
    ...(row ?? {}),
  } as TaxSettingsDueRules;
}

export async function fetchDirectorScorecardClientInvoices(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: import("@/utils/business-unit-view").BusinessUnitReadScope,
): Promise<DirectorScorecardClientInvoiceRow[]> {
  const { applyBusinessUnitScope } = await import("@/utils/business-unit-view");
  const { data } = await applyBusinessUnitScope(
    supabase
      .from("client_invoices")
      .select("invoice_number, invoice_date, status")
      .eq("tenant_id", tenantId),
    buScope,
  );

  return (
    (data as DirectorScorecardClientInvoiceRow[] | null)?.map((row) => ({
      invoice_number: row.invoice_number,
      invoice_date: row.invoice_date,
      status: row.status,
    })) ?? []
  );
}
