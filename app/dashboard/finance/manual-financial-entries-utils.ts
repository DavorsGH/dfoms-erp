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
): ManualFinancialEntryRecord | null {
  const normalized = normalizePeriodMonth(periodMonth);

  return (
    entries.find(
      (entry) => normalizePeriodMonth(entry.period_month) === normalized,
    ) ?? null
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
