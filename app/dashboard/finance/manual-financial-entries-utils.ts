import { formatGHS } from "./income-register-utils";
import { buildPeriodMonth, getPeriodMonthParts } from "./cash-flow-utils";

export { formatGHS, buildPeriodMonth, getPeriodMonthParts };

/** Fields shown in the form and written on save (consumed by BS / cash engine). */
export type ManualEntryFormFieldKey =
  | "bank_loans"
  | "other_long_term_liabilities"
  | "directors_loan"
  | "loan_proceeds"
  | "loan_repayments"
  | "opening_cash_balance"
  | "other_cash_inflows";

/** Legacy columns retained in DB but not edited from the UI. */
export type ManualEntryLegacyColumnKey =
  | "cash_on_hand"
  | "bank_balance"
  | "prepayments_wht_receivable"
  | "inventory_consumables"
  | "accrued_expenses"
  | "withholding_tax_payable"
  | "vat_payable"
  | "retained_earnings_prior_years"
  | "share_capital"
  | "purchase_of_fixed_assets";

export type ManualFinancialEntryRecord = {
  period_month: string;
  tenant_id?: string;
  business_unit_id?: string | null;
} & Partial<Record<ManualEntryFormFieldKey | ManualEntryLegacyColumnKey, number>> & {
  notes?: string | null;
};

export type ManualEntryFieldSection = {
  title: string;
  /** Visual grouping for the form (liability vs cash-flow pairing). */
  variant: "liabilities" | "cashFlow";
  fields: Array<{
    key: ManualEntryFormFieldKey;
    label: string;
  }>;
};

export const MANUAL_ENTRY_PAIRING_NOTE =
  "If you record a liability (like Bank Loans or Director's Loan), also record the matching amount under Loan Proceeds so the Balance Sheet stays balanced — unless it's a non-cash adjustment.";

export const MANUAL_ENTRY_SECTION_STYLES: Record<
  ManualEntryFieldSection["variant"],
  {
    sectionClassName: string;
    headerClassName: string;
    fieldClassName: string;
    inputClassName: string;
    groupLabel: string;
  }
> = {
  liabilities: {
    sectionClassName:
      "rounded-lg border border-amber-200 bg-amber-50/50 p-4 sm:p-5",
    headerClassName: "text-amber-950",
    fieldClassName:
      "rounded-md border border-amber-200/90 border-l-4 border-l-amber-500 bg-amber-50/80 p-3",
    inputClassName:
      "border-amber-200 bg-white focus:border-amber-700 focus:ring-amber-700",
    groupLabel: "Liability — increases what you owe",
  },
  cashFlow: {
    sectionClassName:
      "rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 sm:p-5",
    headerClassName: "text-emerald-950",
    fieldClassName:
      "rounded-md border border-emerald-200/90 border-l-4 border-l-emerald-500 bg-emerald-50/80 p-3",
    inputClassName:
      "border-emerald-200 bg-white focus:border-emerald-700 focus:ring-emerald-700",
    groupLabel: "Cash movement — changes what you hold",
  },
};

export const MANUAL_ENTRY_FIELD_DESCRIPTIONS: Record<
  ManualEntryFormFieldKey,
  string
> = {
  bank_loans: "Outstanding balance owed on bank loans.",
  other_long_term_liabilities:
    "Any other long-term liability not covered by the other fields.",
  directors_loan:
    "Personal money you've contributed to the business, tracked as a repayable loan.",
  loan_proceeds: "New loan money received this month (increases cash).",
  loan_repayments: "Loan payments made this month (decreases cash).",
  opening_cash_balance:
    "Starting cash balance for the year - only needs to be set once, for January.",
  other_cash_inflows:
    "Any other real cash received this month not covered by Sales, Loans, or Capital Contributions.",
};

export const MANUAL_ENTRY_FIELD_SECTIONS: ManualEntryFieldSection[] = [
  {
    title: "Balance Sheet — Liabilities",
    variant: "liabilities",
    fields: [
      { key: "bank_loans", label: "Bank Loans" },
      {
        key: "other_long_term_liabilities",
        label: "Other Long-Term Liabilities",
      },
      { key: "directors_loan", label: "Director's Loan" },
    ],
  },
  {
    title: "Cash Flow Inputs",
    variant: "cashFlow",
    fields: [
      { key: "loan_proceeds", label: "Loan Proceeds" },
      { key: "loan_repayments", label: "Loan Repayments" },
      { key: "opening_cash_balance", label: "Opening Cash Balance" },
      { key: "other_cash_inflows", label: "Other Cash Inflows" },
    ],
  },
];

export const MANUAL_ENTRY_LIST_COLUMNS: Array<{
  key: ManualEntryFormFieldKey;
  label: string;
}> = [
  { key: "bank_loans", label: "Bank Loans" },
  { key: "other_long_term_liabilities", label: "Other LTL" },
  { key: "directors_loan", label: "Director's Loan" },
  { key: "loan_proceeds", label: "Loan Proceeds" },
  { key: "loan_repayments", label: "Loan Repayments" },
  { key: "opening_cash_balance", label: "Opening Cash" },
  { key: "other_cash_inflows", label: "Other Inflows" },
];

export const MANUAL_ENTRY_FORM_FIELD_KEYS = MANUAL_ENTRY_FIELD_SECTIONS.flatMap(
  (section) => section.fields.map((field) => field.key),
);

const MANUAL_ENTRY_LEGACY_COLUMN_KEYS: ManualEntryLegacyColumnKey[] = [
  "cash_on_hand",
  "bank_balance",
  "prepayments_wht_receivable",
  "inventory_consumables",
  "accrued_expenses",
  "withholding_tax_payable",
  "vat_payable",
  "retained_earnings_prior_years",
  "share_capital",
  "purchase_of_fixed_assets",
];

const MANUAL_ENTRY_NUMERIC_KEYS: Array<
  ManualEntryFormFieldKey | ManualEntryLegacyColumnKey
> = [...MANUAL_ENTRY_FORM_FIELD_KEYS, ...MANUAL_ENTRY_LEGACY_COLUMN_KEYS];

export const emptyManualEntryForm: Record<ManualEntryFormFieldKey, string> =
  Object.fromEntries(
    MANUAL_ENTRY_FORM_FIELD_KEYS.map((key) => [key, ""]),
  ) as Record<ManualEntryFormFieldKey, string>;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function normalizePeriodMonth(value: string): string {
  return value.slice(0, 10);
}

export function formatPeriodMonthLabel(periodMonth: string): string {
  const parts = getPeriodMonthParts(periodMonth);
  if (!parts) {
    return periodMonth;
  }

  return `${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
}

export function findEntryByPeriodMonth(
  entries: ManualFinancialEntryRecord[],
  periodMonth: string,
  businessUnitId?: string | null,
): ManualFinancialEntryRecord | null {
  const normalized = normalizePeriodMonth(periodMonth);
  const matchBu =
    businessUnitId === undefined
      ? undefined
      : businessUnitId?.trim() || null;

  return (
    entries.find((entry) => {
      if (normalizePeriodMonth(entry.period_month) !== normalized) {
        return false;
      }
      if (matchBu === undefined) {
        return true;
      }
      const rowBu = entry.business_unit_id?.trim() || null;
      return rowBu === matchBu;
    }) ?? null
  );
}

/** All Businesses: SUM numeric fields by period_month (do not last-wins). */
export function aggregateManualEntriesByPeriodMonth(
  entries: ManualFinancialEntryRecord[],
): ManualFinancialEntryRecord[] {
  const byPeriod = new Map<string, ManualFinancialEntryRecord>();

  for (const entry of entries) {
    const periodMonth = normalizePeriodMonth(entry.period_month);
    const existing = byPeriod.get(periodMonth);
    if (!existing) {
      const seeded: ManualFinancialEntryRecord = {
        period_month: periodMonth,
        tenant_id: entry.tenant_id,
        business_unit_id: null,
        notes: entry.notes ?? null,
      };
      for (const key of MANUAL_ENTRY_NUMERIC_KEYS) {
        seeded[key] = Number(entry[key]) || 0;
      }
      byPeriod.set(periodMonth, seeded);
      continue;
    }

    for (const key of MANUAL_ENTRY_NUMERIC_KEYS) {
      existing[key] = (Number(existing[key]) || 0) + (Number(entry[key]) || 0);
    }
  }

  return [...byPeriod.values()].sort((left, right) =>
    left.period_month.localeCompare(right.period_month),
  );
}

export function entryToForm(
  entry: ManualFinancialEntryRecord,
): Record<ManualEntryFormFieldKey, string> {
  return Object.fromEntries(
    MANUAL_ENTRY_FORM_FIELD_KEYS.map((key) => [key, String(entry[key] ?? 0)]),
  ) as Record<ManualEntryFormFieldKey, string>;
}

export function formToPayload(
  form: Record<ManualEntryFormFieldKey, string>,
  periodMonth: string,
): Pick<ManualFinancialEntryRecord, "period_month" | ManualEntryFormFieldKey> {
  const numericFields = Object.fromEntries(
    MANUAL_ENTRY_FORM_FIELD_KEYS.map((key) => [
      key,
      Number(form[key]) || 0,
    ]),
  ) as Pick<ManualFinancialEntryRecord, ManualEntryFormFieldKey>;

  return {
    period_month: periodMonth,
    ...numericFields,
  };
}

export function getDefaultPeriodSelection(): { year: number; month: number } {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
}

export type LiabilityStockKey =
  | "bank_loans"
  | "other_long_term_liabilities"
  | "directors_loan";

export const LIABILITY_STOCK_LABELS: Record<LiabilityStockKey, string> = {
  bank_loans: "Bank Loans",
  other_long_term_liabilities: "Other Long-Term Liabilities",
  directors_loan: "Director's Loan",
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Month-end liability stock as at a calendar month (FY carry-forward within the year). */
export function resolveLiabilityStockAsAt(
  entries: ManualFinancialEntryRecord[],
  field: LiabilityStockKey,
  year: number,
  month: number,
): number {
  const explicitByMonth = new Map<number, number>();
  for (const entry of entries) {
    const parts = getPeriodMonthParts(entry.period_month);
    if (!parts || parts.year !== year) {
      continue;
    }
    explicitByMonth.set(parts.month, Number(entry[field]) || 0);
  }

  let running = 0;
  for (let m = 1; m <= month; m += 1) {
    if (explicitByMonth.has(m)) {
      running = explicitByMonth.get(m) ?? 0;
    }
  }
  return roundCurrency(running);
}

function baseRowFields(
  existing: ManualFinancialEntryRecord | null,
  periodMonth: string,
  tenantId: string,
  businessUnitId: string | null,
): ManualFinancialEntryRecord {
  const seeded: ManualFinancialEntryRecord = {
    period_month: normalizePeriodMonth(periodMonth),
    tenant_id: tenantId,
    business_unit_id: businessUnitId,
    notes: existing?.notes ?? null,
  };
  for (const key of MANUAL_ENTRY_FORM_FIELD_KEYS) {
    seeded[key] = Number(existing?.[key]) || 0;
  }
  return seeded;
}

function appendNotes(
  existing: string | null | undefined,
  addition: string,
): string {
  const prior = (existing ?? "").trim();
  const next = addition.trim();
  if (!next) {
    return prior;
  }
  if (!prior) {
    return next;
  }
  return `${prior}\n${next}`;
}

export function applyLiabilityMoneyReceived(params: {
  existing: ManualFinancialEntryRecord | null;
  periodMonth: string;
  tenantId: string;
  businessUnitId: string | null;
  stockKey: LiabilityStockKey;
  priorStock: number;
  amount: number;
  notes?: string;
}): ManualFinancialEntryRecord {
  const amount = roundCurrency(params.amount);
  const row = baseRowFields(
    params.existing,
    params.periodMonth,
    params.tenantId,
    params.businessUnitId,
  );
  row[params.stockKey] = roundCurrency(params.priorStock + amount);
  row.loan_proceeds = roundCurrency((Number(row.loan_proceeds) || 0) + amount);
  if (params.notes?.trim()) {
    row.notes = appendNotes(row.notes, params.notes.trim());
  }
  return row;
}

export function applyLiabilityMoneyRepaid(params: {
  existing: ManualFinancialEntryRecord | null;
  periodMonth: string;
  tenantId: string;
  businessUnitId: string | null;
  stockKey: LiabilityStockKey;
  priorStock: number;
  amount: number;
  notes?: string;
}): ManualFinancialEntryRecord {
  const amount = roundCurrency(params.amount);
  const row = baseRowFields(
    params.existing,
    params.periodMonth,
    params.tenantId,
    params.businessUnitId,
  );
  row[params.stockKey] = roundCurrency(Math.max(0, params.priorStock - amount));
  row.loan_repayments = roundCurrency(
    (Number(row.loan_repayments) || 0) + amount,
  );
  if (params.notes?.trim()) {
    row.notes = appendNotes(row.notes, params.notes.trim());
  }
  return row;
}

export function applyLiabilityNonCashAdjustment(params: {
  existing: ManualFinancialEntryRecord | null;
  periodMonth: string;
  tenantId: string;
  businessUnitId: string | null;
  stockKey: LiabilityStockKey;
  priorStock: number;
  amount: number;
  direction: "increase" | "decrease";
  reason: string;
}): ManualFinancialEntryRecord {
  const amount = roundCurrency(params.amount);
  const row = baseRowFields(
    params.existing,
    params.periodMonth,
    params.tenantId,
    params.businessUnitId,
  );
  const nextStock =
    params.direction === "increase"
      ? params.priorStock + amount
      : Math.max(0, params.priorStock - amount);
  row[params.stockKey] = roundCurrency(nextStock);
  row.notes = appendNotes(
    row.notes,
    `[Non-cash] ${params.reason.trim()}`,
  );
  return row;
}

export function applySetOpeningCashBalance(params: {
  existing: ManualFinancialEntryRecord | null;
  periodMonth: string;
  tenantId: string;
  businessUnitId: string | null;
  amount: number;
  notes?: string;
}): ManualFinancialEntryRecord {
  const row = baseRowFields(
    params.existing,
    params.periodMonth,
    params.tenantId,
    params.businessUnitId,
  );
  row.opening_cash_balance = roundCurrency(params.amount);
  if (params.notes?.trim()) {
    row.notes = appendNotes(row.notes, params.notes.trim());
  }
  return row;
}

export function applyAddOtherCashInflows(params: {
  existing: ManualFinancialEntryRecord | null;
  periodMonth: string;
  tenantId: string;
  businessUnitId: string | null;
  amount: number;
  notes?: string;
}): ManualFinancialEntryRecord {
  const amount = roundCurrency(params.amount);
  const row = baseRowFields(
    params.existing,
    params.periodMonth,
    params.tenantId,
    params.businessUnitId,
  );
  row.other_cash_inflows = roundCurrency(
    (Number(row.other_cash_inflows) || 0) + amount,
  );
  if (params.notes?.trim()) {
    row.notes = appendNotes(row.notes, params.notes.trim());
  }
  return row;
}

/** Confirm delete with a full field listing for the month row. */
export function confirmDeleteManualEntry(
  entry: ManualFinancialEntryRecord,
): boolean {
  const lines = MANUAL_ENTRY_LIST_COLUMNS.map(
    (column) => `${column.label}: ${formatGHS(entry[column.key] ?? 0)}`,
  ).join("\n");
  return window.confirm(
    `Delete manual entry for ${formatPeriodMonthLabel(entry.period_month)}?\n\nThis removes the entire month row:\n${lines}`,
  );
}

export function entryToCashMovementManualEntry(
  entry: ManualFinancialEntryRecord,
): {
  period_month: string;
  loan_proceeds?: number;
  loan_repayments?: number;
  other_cash_inflows?: number;
  opening_cash_balance?: number;
  bank_loans?: number;
  other_long_term_liabilities?: number;
  directors_loan?: number;
} {
  return {
    period_month: entry.period_month,
    loan_proceeds: entry.loan_proceeds,
    loan_repayments: entry.loan_repayments,
    other_cash_inflows: entry.other_cash_inflows,
    opening_cash_balance: entry.opening_cash_balance,
    bank_loans: entry.bank_loans,
    other_long_term_liabilities: entry.other_long_term_liabilities,
    directors_loan: entry.directors_loan,
  };
}
