import { calculateDaysOutstanding } from "../finance/accounts-payable-utils";
import type { AccountsPayableEntry } from "../finance/accounts-payable-utils";
import { getMonthEndDate } from "../finance/capital-contributions-utils";
import type { CapitalContributionEntry } from "../finance/capital-contributions-utils";
import type { ManualFinancialEntry } from "../finance/cash-flow-utils";
import { formatPeriodMonthLabel } from "../finance/manual-financial-entries-utils";
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
  normalizeIncomeRegisterEntry,
} from "../finance/income-register-utils";
import { calculateOutstanding } from "../finance/income-register-utils";
import { MONTH_LABELS } from "../finance/profit-loss-utils";

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
  if (entry.outstanding_balance !== null && entry.outstanding_balance !== undefined) {
    return Number(entry.outstanding_balance) || 0;
  }

  return calculateOutstanding(
    Number(entry.amount) || 0,
    Number(entry.amount_received) || 0,
  );
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

function getLatestManualEntry(
  entries: ManualFinancialEntry[],
): ManualFinancialEntry | null {
  if (entries.length === 0) {
    return null;
  }

  return [...entries].sort((left, right) =>
    right.period_month.localeCompare(left.period_month),
  )[0];
}

function mapVendorToStatutoryGroup(
  vendorName: string,
): StatutoryLiabilityGroup | null {
  const normalized = vendorName.trim().toUpperCase();

  if (normalized === "SSNIT") {
    return "SSNIT";
  }

  if (normalized === "GRA") {
    return "PAYE";
  }

  return null;
}

export function buildStatutoryLiabilitiesReport(
  payables: AccountsPayableEntry[],
  manualEntries: ManualFinancialEntry[],
  referenceDate = new Date(),
): {
  rows: StatutoryLiabilityRow[];
  groupTotals: Record<StatutoryLiabilityGroup, number>;
  grandTotal: number;
} {
  const rows: StatutoryLiabilityRow[] = [];

  for (const payable of payables) {
    if (payable.status.trim() !== "Unpaid") {
      continue;
    }

    const group = mapVendorToStatutoryGroup(payable.vendor_name);
    if (!group) {
      continue;
    }

    const amount =
      payable.balance_due !== null && payable.balance_due !== undefined
        ? Number(payable.balance_due) || 0
        : calculateOutstanding(
            Number(payable.amount) || 0,
            Number(payable.amount_paid) || 0,
          );

    if (amount <= 0) {
      continue;
    }

    const daysUntilDue = -calculateDaysOutstanding(
      payable.due_date,
      referenceDate,
    );

    rows.push({
      group,
      description:
        payable.description?.trim() ||
        `${payable.vendor_name} — ${payable.invoice_number}`,
      amount,
      dueDate: payable.due_date,
      daysUntilDue,
    });
  }

  const latestManualEntry = getLatestManualEntry(manualEntries);

  if (latestManualEntry) {
    const vatAmount = Number(latestManualEntry.vat_payable) || 0;
    const whtAmount = Number(latestManualEntry.withholding_tax_payable) || 0;
    const periodLabel = formatPeriodMonthLabel(latestManualEntry.period_month);

    if (vatAmount > 0) {
      rows.push({
        group: "VAT",
        description: `VAT Payable (${periodLabel})`,
        amount: vatAmount,
        dueDate: getMonthEndDate(
          Number(latestManualEntry.period_month.slice(0, 4)),
          Number(latestManualEntry.period_month.slice(5, 7)),
        ),
        daysUntilDue: latestManualEntry.period_month
          ? -calculateDaysOutstanding(
              getMonthEndDate(
                Number(latestManualEntry.period_month.slice(0, 4)),
                Number(latestManualEntry.period_month.slice(5, 7)),
              ),
              referenceDate,
            )
          : null,
      });
    }

    if (whtAmount > 0) {
      rows.push({
        group: "WHT Payable",
        description: `Withholding Tax Payable (${periodLabel})`,
        amount: whtAmount,
        dueDate: getMonthEndDate(
          Number(latestManualEntry.period_month.slice(0, 4)),
          Number(latestManualEntry.period_month.slice(5, 7)),
        ),
        daysUntilDue: latestManualEntry.period_month
          ? -calculateDaysOutstanding(
              getMonthEndDate(
                Number(latestManualEntry.period_month.slice(0, 4)),
                Number(latestManualEntry.period_month.slice(5, 7)),
              ),
              referenceDate,
            )
          : null,
      });
    }
  }

  const groupOrder: StatutoryLiabilityGroup[] = [
    "SSNIT",
    "PAYE",
    "VAT",
    "WHT Payable",
  ];

  rows.sort(
    (left, right) =>
      groupOrder.indexOf(left.group) - groupOrder.indexOf(right.group) ||
      (left.dueDate ?? "").localeCompare(right.dueDate ?? ""),
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
