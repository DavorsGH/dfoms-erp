import { calculateDaysOutstanding } from "../finance/accounts-payable-utils";
import {
  isPaidStatus,
  isSettledNoCashImpactStatus,
} from "../finance/accrued-wages-utils";
import { getMonthEndDate } from "../finance/capital-contributions-utils";
import type { CapitalContributionEntry } from "../finance/capital-contributions-utils";
import {
  calculateAssetAccumulatedDepreciationAsOf,
  calculateAssetNetBookValueAsOf,
  calculateTotalCost,
  type AssetDepreciationInput,
} from "../finance/fixed-assets-utils";
import type { IncomeRegisterEntry } from "../finance/income-register-utils";
import {
  getIncomeCustomerDisplayName,
  isActiveIncomeForReporting,
  resolveIncomeOutstandingBalance,
} from "../finance/income-register-utils";
import { getEntryMonthIndex, MONTH_LABELS } from "../finance/profit-loss-utils";
import {
  getComponentLabel,
  summarizeOpenTaxBalances,
  type TaxLedgerBalanceSource,
  type TaxLedgerComponent,
} from "../finance/tax-ledger-utils";

export const REPORT_MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
] as const;

export type StatementReportRow = {
  key: string;
  label: string;
  amount: number;
  kind: string;
};

export type AgingBucketKey =
  | "current"
  | "1-30"
  | "31-60"
  | "61-90"
  | "90+";

export type AccountsReceivableAgingRow = {
  invoiceNo: string;
  customerName: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  amountReceived: number;
  outstandingBalance: number;
  daysOverdue: number;
  bucket: AgingBucketKey;
};

export type StatutoryLiabilityGroup =
  | "SSNIT"
  | "PAYE"
  | "VAT"
  | "WHT Payable";

export type StatutoryLiabilityRow = {
  group: StatutoryLiabilityGroup;
  description: string;
  amount: number;
  dueDate: string | null;
  daysUntilDue: number | null;
};

/** Optional due dates from tax_settings (same reminders as Statutory Ledger). */
export type StatutoryLiabilityDueDates = {
  next_ssnit_due_date?: string | null;
  next_tier2_due_date?: string | null;
  next_paye_due_date?: string | null;
  next_vat_due_date?: string | null;
  next_wht_due_date?: string | null;
};

export type FixedAssetScheduleRow = {
  assetId: string;
  assetName: string;
  category: string;
  purchaseDate: string;
  originalCost: number;
  accumulatedDepreciation: number;
  netBookValue: number;
};

export type CapitalContributionSummaryRow = {
  id: string;
  date: string;
  contributedBy: string;
  amount: number;
  description: string;
  runningTotal: number;
};

export function getDefaultReportMonthYear(): { year: number; month: number } {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
}

export function monthIndexFromMonthNumber(month: number): number {
  return Math.min(Math.max(month, 1), 12) - 1;
}

export function formatReportPeriodLabel(year: number, month: number): string {
  const monthLabel =
    REPORT_MONTH_OPTIONS.find((option) => option.value === month)?.label ??
    MONTH_LABELS[month - 1] ??
    String(month);

  return `${monthLabel} ${year}`;
}

export function getReportMonthEndDate(year: number, month: number): string {
  return getMonthEndDate(year, month);
}

export function extractStatementRowsForMonth<
  T extends { key: string; label: string; amounts: number[]; kind: string },
>(rows: T[], monthIndex: number): StatementReportRow[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    amount: row.kind === "section" ? 0 : (row.amounts[monthIndex] ?? 0),
    kind: row.kind,
  }));
}

function getOutstandingBalance(entry: IncomeRegisterEntry): number {
  return resolveIncomeOutstandingBalance(entry);
}

export function getAgingBucket(daysOverdue: number): AgingBucketKey {
  if (daysOverdue <= 0) {
    return "current";
  }

  if (daysOverdue <= 30) {
    return "1-30";
  }

  if (daysOverdue <= 60) {
    return "31-60";
  }

  if (daysOverdue <= 90) {
    return "61-90";
  }

  return "90+";
}

export const AGING_BUCKET_LABELS: Record<AgingBucketKey, string> = {
  current: "Current (not yet due)",
  "1-30": "1–30 days overdue",
  "31-60": "31–60 days overdue",
  "61-90": "61–90 days overdue",
  "90+": "90+ days overdue",
};

export function buildAccountsReceivableAgingReport(
  entries: IncomeRegisterEntry[],
  referenceDate = new Date(),
): {
  rows: AccountsReceivableAgingRow[];
  bucketTotals: Record<AgingBucketKey, number>;
  totalOutstanding: number;
} {
  const rows = entries
    .filter((entry) => isActiveIncomeForReporting(entry))
    .map((entry) => {
      const outstandingBalance = getOutstandingBalance(entry);

      if (outstandingBalance <= 0) {
        return null;
      }

      const rawDays = calculateDaysOutstanding(entry.due_date, referenceDate);
      const daysOverdue = Math.max(rawDays, 0);

      return {
        invoiceNo: entry.invoice_no,
        customerName: getIncomeCustomerDisplayName(entry),
        invoiceDate: entry.date,
        dueDate: entry.due_date,
        amount: Number(entry.amount) || 0,
        amountReceived: Number(entry.amount_received) || 0,
        outstandingBalance,
        daysOverdue,
        bucket: getAgingBucket(rawDays),
      };
    })
    .filter((row): row is AccountsReceivableAgingRow => row !== null)
    .sort((left, right) => right.daysOverdue - left.daysOverdue);

  const bucketTotals: Record<AgingBucketKey, number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };

  let totalOutstanding = 0;

  for (const row of rows) {
    bucketTotals[row.bucket] += row.outstandingBalance;
    totalOutstanding += row.outstandingBalance;
  }

  return { rows, bucketTotals, totalOutstanding };
}

function daysUntilDueFromDate(
  dueDate: string | null | undefined,
  referenceDate: Date,
): number | null {
  if (!dueDate) {
    return null;
  }
  return -calculateDaysOutstanding(dueDate.slice(0, 10), referenceDate);
}

function pushStatutoryRow(
  rows: StatutoryLiabilityRow[],
  group: StatutoryLiabilityGroup,
  description: string,
  amount: number,
  dueDate: string | null | undefined,
  referenceDate: Date,
) {
  const rounded = Math.round((Number(amount) || 0) * 100) / 100;
  if (rounded <= 0) {
    return;
  }
  const normalizedDue = dueDate?.slice(0, 10) ?? null;
  rows.push({
    group,
    description,
    amount: rounded,
    dueDate: normalizedDue,
    daysUntilDue: daysUntilDueFromDate(normalizedDue, referenceDate),
  });
}

/**
 * Open statutory remittance liabilities from tax_ledger_entries (status='open').
 * Uses summarizeOpenTaxBalances — same aggregation as the Statutory Ledger overview.
 * VAT = net output − input when positive (payable only). AP / MFE sources retired.
 */
export function buildStatutoryLiabilitiesReport(
  taxLedgerEntries: TaxLedgerBalanceSource[],
  dueDates: StatutoryLiabilityDueDates | null = null,
  referenceDate = new Date(),
): {
  rows: StatutoryLiabilityRow[];
  groupTotals: Record<StatutoryLiabilityGroup, number>;
  grandTotal: number;
} {
  const summary = summarizeOpenTaxBalances(taxLedgerEntries);
  const rows: StatutoryLiabilityRow[] = [];

  const ssnitLines: {
    component: TaxLedgerComponent;
    amount: number;
    dueDate: string | null | undefined;
  }[] = [
    {
      component: "ssnit_employee",
      amount: summary.ssnitEmployee,
      dueDate: dueDates?.next_ssnit_due_date,
    },
    {
      component: "ssnit_employer_tier1",
      amount: summary.ssnitEmployerTier1,
      dueDate: dueDates?.next_ssnit_due_date,
    },
    {
      component: "ssnit_tier2",
      amount: summary.ssnitTier2,
      dueDate: dueDates?.next_tier2_due_date,
    },
  ];

  for (const line of ssnitLines) {
    pushStatutoryRow(
      rows,
      "SSNIT",
      `${getComponentLabel(line.component)} (open)`,
      line.amount,
      line.dueDate,
      referenceDate,
    );
  }

  pushStatutoryRow(
    rows,
    "PAYE",
    "PAYE Payable (open)",
    summary.payePayable,
    dueDates?.next_paye_due_date,
    referenceDate,
  );

  // Liabilities report: only the payable side of net VAT (matches Balance Sheet).
  const vatPayable = summary.netVatPosition > 0 ? summary.netVatPosition : 0;
  pushStatutoryRow(
    rows,
    "VAT",
    "Net VAT Payable (output − input, open)",
    vatPayable,
    dueDates?.next_vat_due_date,
    referenceDate,
  );

  pushStatutoryRow(
    rows,
    "WHT Payable",
    "WHT Payable (open)",
    summary.whtPayable,
    dueDates?.next_wht_due_date,
    referenceDate,
  );

  const groupOrder: StatutoryLiabilityGroup[] = [
    "SSNIT",
    "PAYE",
    "VAT",
    "WHT Payable",
  ];

  rows.sort(
    (left, right) =>
      groupOrder.indexOf(left.group) - groupOrder.indexOf(right.group) ||
      (left.dueDate ?? "").localeCompare(right.dueDate ?? "") ||
      left.description.localeCompare(right.description),
  );

  const groupTotals: Record<StatutoryLiabilityGroup, number> = {
    SSNIT: 0,
    PAYE: 0,
    VAT: 0,
    "WHT Payable": 0,
  };

  let grandTotal = 0;

  for (const row of rows) {
    groupTotals[row.group] += row.amount;
    grandTotal += row.amount;
  }

  return { rows, groupTotals, grandTotal };
}

export type FixedAssetScheduleAsset = AssetDepreciationInput & {
  asset_id: string;
  asset_name: string;
  asset_category: string;
  purchase_date: string;
};

export function buildFixedAssetDepreciationSchedule(
  assets: FixedAssetScheduleAsset[],
  year: number,
  month: number,
): {
  rows: FixedAssetScheduleRow[];
  totalOriginalCost: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
} {
  const asOfMonthEnd = getReportMonthEndDate(year, month);

  const rows = assets.map((asset) => {
    const originalCost = calculateTotalCost(
      Number(asset.original_cost) || 0,
      Number(asset.quantity) || 0,
    );
    const accumulatedDepreciation = calculateAssetAccumulatedDepreciationAsOf(
      asset,
      asOfMonthEnd,
    );
    const netBookValue = calculateAssetNetBookValueAsOf(asset, asOfMonthEnd);

    return {
      assetId: asset.asset_id,
      assetName: asset.asset_name,
      category: asset.asset_category,
      purchaseDate: asset.purchase_date,
      originalCost,
      accumulatedDepreciation,
      netBookValue,
    };
  });

  const totalOriginalCost = rows.reduce((sum, row) => sum + row.originalCost, 0);
  const totalAccumulatedDepreciation = rows.reduce(
    (sum, row) => sum + row.accumulatedDepreciation,
    0,
  );
  const totalNetBookValue = rows.reduce((sum, row) => sum + row.netBookValue, 0);

  return {
    rows,
    totalOriginalCost,
    totalAccumulatedDepreciation,
    totalNetBookValue,
  };
}

export function buildCapitalContributionsSummary(
  contributions: CapitalContributionEntry[],
  getContributorLabel: (entry: CapitalContributionEntry) => string,
): {
  rows: CapitalContributionSummaryRow[];
  grandTotal: number;
} {
  const sorted = [...contributions].sort((left, right) =>
    left.date.localeCompare(right.date),
  );

  let runningTotal = 0;
  const rows = sorted.map((entry) => {
    runningTotal += Number(entry.amount) || 0;

    return {
      id: entry.id,
      date: entry.date,
      contributedBy: getContributorLabel(entry),
      amount: Number(entry.amount) || 0,
      description: entry.description?.trim() || "—",
      runningTotal,
    };
  });

  return {
    rows,
    grandTotal: runningTotal,
  };
}

export type ExpenseReportSourceEntry = {
  id?: string | null;
  date: string;
  description?: string | null;
  expense_category: string;
  sub_category?: string | null;
  payment_status: string;
  amount: number;
};

export type ExpenseReportLine = {
  key: string;
  date: string;
  description: string;
  category: string;
  paymentStatus: string;
  amount: number;
  isPaid: boolean;
  isSettledNoCash: boolean;
};

export type ExpenseReportCategoryGroup = {
  category: string;
  rows: ExpenseReportLine[];
  subtotal: number;
};

function roundReportCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveExpenseReportCategoryLabel(
  entry: ExpenseReportSourceEntry,
): string {
  const category = entry.expense_category?.trim() || "Uncategorized";
  const subCategory = entry.sub_category?.trim();

  if (!subCategory) {
    return category;
  }

  return `${category} / ${subCategory}`;
}

function resolveExpenseReportGroupKey(entry: ExpenseReportSourceEntry): string {
  return entry.expense_category?.trim() || "Uncategorized";
}

/**
 * Monthly expense_register report. Paid vs accrued totals reuse isPaidStatus()
 * (same gate as calculateCashAndCashEquivalentsByMonth / isCashOutflowExpense).
 * Settled (No Cash Impact) is neither Paid (cash) nor Accrued (unpaid).
 */
export function buildExpenseReport(
  entries: ExpenseReportSourceEntry[],
  year: number,
  month: number,
): {
  groups: ExpenseReportCategoryGroup[];
  grandTotal: number;
  totalPaid: number;
  totalAccrued: number;
  totalSettledNoCash: number;
} {
  const monthIndex = monthIndexFromMonthNumber(month);
  const grouped = new Map<string, ExpenseReportLine[]>();

  const monthEntries = entries
    .filter((entry) => getEntryMonthIndex(entry.date, year) === monthIndex)
    .sort((left, right) => {
      const groupCompare = resolveExpenseReportGroupKey(left).localeCompare(
        resolveExpenseReportGroupKey(right),
      );
      if (groupCompare !== 0) {
        return groupCompare;
      }

      const dateCompare = left.date.localeCompare(right.date);
      if (dateCompare !== 0) {
        return dateCompare;
      }

      return resolveExpenseReportCategoryLabel(left).localeCompare(
        resolveExpenseReportCategoryLabel(right),
      );
    });

  monthEntries.forEach((entry, index) => {
    const groupKey = resolveExpenseReportGroupKey(entry);
    const amount = Number(entry.amount) || 0;
    const line: ExpenseReportLine = {
      key: entry.id?.trim() || `${entry.date}-${groupKey}-${index}`,
      date: entry.date,
      description: entry.description?.trim() || "—",
      category: resolveExpenseReportCategoryLabel(entry),
      paymentStatus: entry.payment_status?.trim() || "—",
      amount,
      isPaid: isPaidStatus(entry.payment_status),
      isSettledNoCash: isSettledNoCashImpactStatus(entry.payment_status),
    };

    const rows = grouped.get(groupKey) ?? [];
    rows.push(line);
    grouped.set(groupKey, rows);
  });

  const groups = Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, rows]) => ({
      category,
      rows,
      subtotal: roundReportCurrency(
        rows.reduce((sum, row) => sum + row.amount, 0),
      ),
    }));

  const grandTotal = roundReportCurrency(
    groups.reduce((sum, group) => sum + group.subtotal, 0),
  );
  const totalPaid = roundReportCurrency(
    groups.reduce(
      (sum, group) =>
        sum +
        group.rows.reduce(
          (groupSum, row) => groupSum + (row.isPaid ? row.amount : 0),
          0,
        ),
      0,
    ),
  );
  const totalSettledNoCash = roundReportCurrency(
    groups.reduce(
      (sum, group) =>
        sum +
        group.rows.reduce(
          (groupSum, row) => groupSum + (row.isSettledNoCash ? row.amount : 0),
          0,
        ),
      0,
    ),
  );
  // Accrued = not Paid and not Settled (Pending/Partial/Overdue/Accrued/…).
  const totalAccrued = roundReportCurrency(
    grandTotal - totalPaid - totalSettledNoCash,
  );

  return {
    groups,
    grandTotal,
    totalPaid,
    totalAccrued,
    totalSettledNoCash,
  };
}
