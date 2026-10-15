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
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import {
  defaultDueRulesPartial,
  listStatutoryPeriodObligations,
  OBLIGATION_KIND_LABELS,
  type StatutoryDueRuleKind,
  type StatutoryPeriodObligation,
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
import {
  balanceSheetHrefForScorecardMonth,
  clientInvoicesListHref,
  periodMonthToTaxLedgerParam,
  statutoryLedgerHref,
  type DirectorScorecardChecklistLink,
  type DirectorScorecardUnpaidInvoiceLink,
} from "@/app/dashboard/director-scorecard-links";

export type DirectorScorecardChecklistChipStatus = "done" | "todo" | "overdue";

export type DirectorScorecardChecklistItem = {
  id: string;
  label: string;
  pass: boolean;
  chipStatus: DirectorScorecardChecklistChipStatus;
  reason: string;
  links?: DirectorScorecardChecklistLink[];
  unpaidInvoiceLinks?: DirectorScorecardUnpaidInvoiceLink[];
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
  id: string;
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

const CHECKLIST_MONTH_SHORT = [
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
] as const;

const STATUTORY_KIND_ORDER: StatutoryDueRuleKind[] = [
  "paye",
  "ssnit",
  "tier2",
  "vat",
  "wht",
];

function parsePeriodMonthParts(
  periodMonth: string,
): { year: number; month: number } | null {
  const year = Number(periodMonth.slice(0, 4));
  const month = Number(periodMonth.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

function monthSortKey(parts: { year: number; month: number }): number {
  return parts.year * 12 + parts.month;
}

function formatMonthYearShort(parts: { year: number; month: number }): string {
  return `${CHECKLIST_MONTH_SHORT[parts.month - 1]} ${parts.year}`;
}

function formatMonthSpanLabel(
  months: Array<{ year: number; month: number }>,
): string {
  if (months.length === 0) {
    return "";
  }
  const sorted = [...months].sort((left, right) => monthSortKey(left) - monthSortKey(right));
  if (sorted.length === 1) {
    return formatMonthYearShort(sorted[0]!);
  }

  const sameYear = sorted.every((row) => row.year === sorted[0]!.year);
  let consecutive = sameYear;
  if (consecutive) {
    for (let index = 1; index < sorted.length; index += 1) {
      if (monthSortKey(sorted[index]!) - monthSortKey(sorted[index - 1]!) !== 1) {
        consecutive = false;
        break;
      }
    }
  }

  if (consecutive && sameYear) {
    const start = CHECKLIST_MONTH_SHORT[sorted[0]!.month - 1];
    const end = CHECKLIST_MONTH_SHORT[sorted[sorted.length - 1]!.month - 1];
    return `${start}–${end} ${sorted[0]!.year}`;
  }

  return sorted.map((row) => formatMonthYearShort(row)).join(", ");
}

function formatIsoDueDateShort(iso: string): string {
  const trimmed = iso.slice(0, 10);
  const [year, month, day] = trimmed.split("-");
  const monthNumber = Number(month);
  if (!day || monthNumber < 1 || monthNumber > 12) {
    return trimmed;
  }
  return `${day} ${CHECKLIST_MONTH_SHORT[monthNumber - 1]} ${year}`;
}

function formatStatutoryChecklistReason(
  overdue: StatutoryPeriodObligation[],
): string {
  if (overdue.length === 0) {
    return "All PAYE and SSNIT payments are up to date.";
  }

  const sourceRows = overdue;

  const monthsByKind = new Map<StatutoryDueRuleKind, Array<{ year: number; month: number }>>();
  for (const row of sourceRows) {
    const parts = parsePeriodMonthParts(row.periodMonth);
    if (!parts) {
      continue;
    }
    const bucket = monthsByKind.get(row.kind) ?? [];
    bucket.push(parts);
    monthsByKind.set(row.kind, bucket);
  }

  const segments: string[] = [];
  for (const kind of STATUTORY_KIND_ORDER) {
    const months = monthsByKind.get(kind);
    if (!months?.length) {
      continue;
    }
    const unique = Array.from(
      new Map(months.map((row) => [monthSortKey(row), row])).values(),
    );
    segments.push(`${OBLIGATION_KIND_LABELS[kind]}: ${formatMonthSpanLabel(unique)}`);
  }

  const oldestDue = overdue
    .map((row) => row.dueDate)
    .sort((left, right) => left.localeCompare(right))[0];

  const summary = segments.join(" · ");
  if (oldestDue) {
    return `${summary}. Oldest due ${formatIsoDueDateShort(oldestDue)}.`;
  }
  return `${summary}.`;
}

function checklistChipStatus(
  pass: boolean,
  itemId: string,
  statutoryHasOverdue: boolean,
  statutoryHasOpen: boolean,
): DirectorScorecardChecklistChipStatus {
  if (pass) {
    return "done";
  }
  if (itemId === "statutory") {
    if (statutoryHasOverdue) {
      return "overdue";
    }
    if (statutoryHasOpen) {
      return "todo";
    }
    return "todo";
  }
  return "todo";
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
  balanceCheckDifference: number;
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
    ? "All client invoices for the quarter are paid."
    : `Waiting for payment: ${unpaidInvoices.map((row) => row.invoice_number).join(", ")}.`;

  const obligations = listStatutoryPeriodObligations({
    entries: input.taxLedgerSources,
    settings: input.taxSettings,
    todayIso: input.todayIso,
  });
  const overdue = obligations.filter(
    (row) => row.isOverdue && (row.openAmount ?? 0) > 0.005,
  );
  const openObligations = obligations.filter(
    (row) => (row.openAmount ?? 0) > 0.005,
  );
  const statutoryPass = overdue.length === 0;
  const statutoryReason = formatStatutoryChecklistReason(overdue);

  const cashReservePass = input.cashPosition >= input.payrollCost - 0.005;
  const cashReserveReason = cashReservePass
    ? `Cash ${formatGHS(input.cashPosition)} covers one month of payroll (${formatGHS(input.payrollCost)}).`
    : `Cash ${formatGHS(input.cashPosition)}. Target ${formatGHS(input.payrollCost)} (${formatGHS(Math.max(0, input.payrollCost - input.cashPosition))} to go).`;

  const balancePass = input.balanceCheckBalanced;
  const balanceReason = balancePass
    ? "The Balance Sheet is balanced."
    : `The Balance Sheet is out by ${formatGHS(Math.abs(input.balanceCheckDifference))} — check Finance → Balance Sheet.`;

  const cashAfterDividend =
    input.cashPosition - input.grossDividend - input.taxToSetAside;
  const dividendCashPass =
    cashAfterDividend >= input.payrollCost - 0.005;
  let dividendCashReason: string;
  if (input.grossDividend <= 0.005) {
    const cashAfterTaxSetAside = roundCurrency(
      input.cashPosition - input.taxToSetAside,
    );
    if (cashAfterTaxSetAside >= input.payrollCost - 0.005) {
      dividendCashReason = `No dividend available yet. Cash ${formatGHS(input.cashPosition)} covers next payroll (${formatGHS(input.payrollCost)}).`;
    } else {
      dividendCashReason = `No dividend available yet. Cash ${formatGHS(input.cashPosition)} is below next payroll (${formatGHS(input.payrollCost)}).`;
    }
  } else if (dividendCashPass) {
    dividendCashReason = `After the dividend and tax set-aside, cash of ${formatGHS(cashAfterDividend)} still covers next payroll (${formatGHS(input.payrollCost)}).`;
  } else {
    dividendCashReason = `Paying the dividend now would leave ${formatGHS(cashAfterDividend)}. Keep at least ${formatGHS(input.payrollCost)} for next payroll.`;
  }

  const balanceSheetHref = balanceSheetHrefForScorecardMonth(input.year, input.month);
  const oldestOverduePeriodMonth =
    overdue.length > 0
      ? periodMonthToTaxLedgerParam(
          [...overdue]
            .sort((left, right) => left.periodMonth.localeCompare(right.periodMonth))[0]!
            .periodMonth,
        )
      : null;

  const items: DirectorScorecardChecklistItem[] = [
    {
      id: "client-invoices",
      label: "Client invoices paid",
      pass: invoicesPass,
      chipStatus: checklistChipStatus(invoicesPass, "client-invoices", false, false),
      reason: invoicesReason,
      unpaidInvoiceLinks: invoicesPass
        ? undefined
        : unpaidInvoices.map((row) => ({
            id: row.id,
            invoiceNumber: row.invoice_number,
          })),
      links: invoicesPass
        ? [
            {
              label: "View invoices →",
              href: clientInvoicesListHref(),
            },
          ]
        : [
            {
              label: "Record payment →",
              href: clientInvoicesListHref({ unpaidOnly: true }),
            },
          ],
    },
    {
      id: "statutory",
      label: "GRA and SSNIT payments",
      pass: statutoryPass,
      chipStatus: checklistChipStatus(
        statutoryPass,
        "statutory",
        overdue.length > 0,
        openObligations.length > 0,
      ),
      reason: statutoryReason,
      links: statutoryPass
        ? [
            {
              label: "View payments →",
              href: statutoryLedgerHref(),
            },
          ]
        : [
            {
              label: "Pay or record →",
              href: statutoryLedgerHref(oldestOverduePeriodMonth),
            },
          ],
    },
    {
      id: "cash-reserve",
      label: "Cash cushion of one month's payroll",
      pass: cashReservePass,
      chipStatus: checklistChipStatus(cashReservePass, "cash-reserve", false, false),
      reason: cashReserveReason,
      links: [
        {
          label: "View cash position →",
          href: balanceSheetHref,
        },
      ],
    },
    {
      id: "balance-sheet",
      label: "Books balance",
      pass: balancePass,
      chipStatus: checklistChipStatus(balancePass, "balance-sheet", false, false),
      reason: balanceReason,
      links: [
        {
          label: balancePass ? "View Balance Sheet →" : "Check Balance Sheet →",
          href: balanceSheetHref,
        },
      ],
    },
    {
      id: "dividend-cash",
      label: "Enough cash after the dividend",
      pass: dividendCashPass,
      chipStatus: checklistChipStatus(dividendCashPass, "dividend-cash", false, false),
      reason: dividendCashReason,
      links: [
        {
          label: "View cash position →",
          href: balanceSheetHref,
        },
      ],
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
      balanceCheckDifference: monthSnapshot.summary.balanceCheck.difference,
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
      .select("id, invoice_number, invoice_date, status")
      .eq("tenant_id", tenantId),
    buScope,
  );

  return (
    (data as DirectorScorecardClientInvoiceRow[] | null)?.map((row) => ({
      id: row.id,
      invoice_number: row.invoice_number,
      invoice_date: row.invoice_date,
      status: row.status,
    })) ?? []
  );
}
