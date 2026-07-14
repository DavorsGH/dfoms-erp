import { formatGHS } from "./income-register-utils";
import { buildPeriodMonth, getPeriodMonthParts } from "./cash-flow-utils";

export { formatGHS, buildPeriodMonth, getPeriodMonthParts };

export type ManualEntryFormFieldKey =
  | "cash_on_hand"
  | "bank_balance"
  | "prepayments_wht_receivable"
  | "inventory_consumables"
  | "accrued_expenses"
  | "withholding_tax_payable"
  | "vat_payable"
  | "bank_loans"
  | "other_long_term_liabilities"
  | "retained_earnings_prior_years"
  | "purchase_of_fixed_assets"
  | "loan_proceeds"
  | "loan_repayments"
  | "opening_cash_balance"
  | "other_cash_inflows";

export type ManualFinancialEntryRecord = {
  id: string;
  period_month: string;
  share_capital?: number;
} & Partial<Record<ManualEntryFormFieldKey, number>>;

export type ManualEntryFieldSection = {
  title: string;
  fields: Array<{
    key: ManualEntryFormFieldKey;
    label: string;
  }>;
};

export const MANUAL_ENTRY_FIELD_SECTIONS: ManualEntryFieldSection[] = [
  {
    title: "Balance Sheet — Assets",
    fields: [
      { key: "cash_on_hand", label: "Cash on Hand" },
      { key: "bank_balance", label: "Bank Balance" },
      {
        key: "prepayments_wht_receivable",
        label: "Prepayments / WHT Receivable",
      },
      { key: "inventory_consumables", label: "Inventory / Consumables" },
    ],
  },
  {
    title: "Balance Sheet — Liabilities",
    fields: [
      { key: "accrued_expenses", label: "Accrued Expenses" },
      { key: "withholding_tax_payable", label: "Withholding Tax Payable" },
      { key: "vat_payable", label: "VAT Payable" },
      { key: "bank_loans", label: "Bank Loans" },
      {
        key: "other_long_term_liabilities",
        label: "Other Long-Term Liabilities",
      },
    ],
  },
  {
    title: "Balance Sheet — Equity",
    fields: [
      {
        key: "retained_earnings_prior_years",
        label: "Retained Earnings (Prior Years)",
      },
    ],
  },
  {
    title: "Cash Flow Inputs",
    fields: [
      { key: "purchase_of_fixed_assets", label: "Purchase of Fixed Assets" },
      { key: "loan_proceeds", label: "Loan Proceeds" },
      { key: "loan_repayments", label: "Loan Repayments" },
      { key: "opening_cash_balance", label: "Opening Cash Balance" },
      { key: "other_cash_inflows", label: "Other Cash Inflows" },
    ],
  },
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
  const normalized = periodMonth.slice(0, 10);

  return (
    entries.find((entry) => entry.period_month.slice(0, 10) === normalized) ??
    null
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
): Omit<ManualFinancialEntryRecord, "id" | "share_capital"> {
  const numericFields = Object.fromEntries(
    MANUAL_ENTRY_FORM_FIELD_KEYS.map((key) => [
      key,
      Number(form[key]) || 0,
    ]),
  ) as Pick<
    ManualFinancialEntryRecord,
    ManualEntryFormFieldKey
  >;

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
