import { formatGHS, formatDate } from "./income-register-utils";
import type { TaxLedgerSourceType } from "./tax-ledger-sync";

export { formatGHS, formatDate };

export const TAX_LEDGER_SELECT =
  "id, tenant_id, entry_date, period_month, direction, tax_component, rate_pct, taxable_base, tax_amount, status, source_type, source_id, counterparty_name, notes, created_at, updated_at";

export type TaxLedgerDirection =
  | "output"
  | "input"
  | "wht_receivable"
  | "wht_payable"
  | "settlement";

export type TaxLedgerComponent = "vat_bundle" | "vfrs" | "wht";

/**
 * Schema CHECK (script 113): open | filed | paid | reversed.
 * There is no 'remitted' value — UI "Mark as Remitted" maps to status='paid'.
 */
export type TaxLedgerStatus = "open" | "filed" | "paid" | "reversed";

export type TaxLedgerEntry = {
  id: string;
  tenant_id: string;
  entry_date: string;
  period_month: string;
  direction: TaxLedgerDirection;
  tax_component: TaxLedgerComponent;
  rate_pct: number | null;
  taxable_base: number;
  tax_amount: number;
  status: TaxLedgerStatus;
  source_type: TaxLedgerSourceType;
  source_id: string | null;
  counterparty_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type TaxBalanceSummary = {
  whtReceivable: number;
  whtPayable: number;
  outputVatBundle: number;
  outputVfrs: number;
  outputTotal: number;
  inputTax: number;
  netVatPosition: number;
};

export type TaxLedgerFilters = {
  periodMonth: string;
  taxComponent: string;
  direction: string;
  status: string;
};

export const REMINDER_WINDOW_DAYS = 7;

/** Closest allowed status for a GRA remittance without a schema change. */
export const REMITTED_STATUS: TaxLedgerStatus = "paid";

const DIRECTION_LABELS: Record<TaxLedgerDirection, string> = {
  output: "Output",
  input: "Input",
  wht_receivable: "WHT Receivable",
  wht_payable: "WHT Payable",
  settlement: "Settlement",
};

const COMPONENT_LABELS: Record<TaxLedgerComponent, string> = {
  vat_bundle: "VAT/NHIL/GETFund",
  vfrs: "VFRS",
  wht: "WHT",
};

const STATUS_LABELS: Record<TaxLedgerStatus, string> = {
  open: "Open",
  filed: "Filed",
  paid: "Paid / Remitted",
  reversed: "Reversed",
};

const SOURCE_LABELS: Record<TaxLedgerSourceType, string> = {
  income_register: "Income Register",
  client_invoice: "Customer Invoice",
  expense_register: "Expense Register",
  accounts_payable: "Accounts Payable",
  product_sale: "Product Sale",
  manual: "Manual",
  settlement: "Settlement",
};

export function normalizeTaxLedgerEntry(
  raw: TaxLedgerEntry,
): TaxLedgerEntry {
  return {
    ...raw,
    entry_date: raw.entry_date?.slice(0, 10) ?? raw.entry_date,
    period_month: raw.period_month?.slice(0, 10) ?? raw.period_month,
    rate_pct: raw.rate_pct == null ? null : Number(raw.rate_pct),
    taxable_base: Number(raw.taxable_base) || 0,
    tax_amount: Number(raw.tax_amount) || 0,
    counterparty_name: raw.counterparty_name ?? null,
    notes: raw.notes ?? null,
    source_id: raw.source_id ?? null,
  };
}

export function getDirectionLabel(direction: TaxLedgerDirection): string {
  return DIRECTION_LABELS[direction] ?? direction;
}

export function getComponentLabel(component: TaxLedgerComponent): string {
  return COMPONENT_LABELS[component] ?? component;
}

export function getStatusLabel(status: TaxLedgerStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function getSourceTypeLabel(sourceType: TaxLedgerSourceType): string {
  return SOURCE_LABELS[sourceType] ?? sourceType;
}

export function getSourceHref(
  sourceType: TaxLedgerSourceType,
  sourceId: string | null,
): string | null {
  switch (sourceType) {
    case "income_register":
      return "/dashboard/finance";
    case "expense_register":
      return "/dashboard/finance/expenses";
    case "accounts_payable":
      return "/dashboard/finance/accounts-payable";
    case "client_invoice":
      return sourceId
        ? `/dashboard/finance/client-invoices/${sourceId}`
        : "/dashboard/finance/client-invoices";
    case "product_sale":
      return "/dashboard/finance/product-sales";
    default:
      return null;
  }
}

export function formatSourceReference(entry: TaxLedgerEntry): string {
  const typeLabel = getSourceTypeLabel(entry.source_type);
  const counterparty = entry.counterparty_name?.trim();
  if (counterparty) {
    return `${typeLabel} · ${counterparty}`;
  }

  if (entry.source_id) {
    return `${typeLabel} · ${entry.source_id.slice(0, 8)}…`;
  }

  return typeLabel;
}

export function formatPeriodMonthLabel(periodMonth: string): string {
  const date = new Date(`${periodMonth.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return periodMonth;
  }

  return date.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export function getCurrentPeriodMonth(today = new Date()): string {
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

export function emptyBalanceSummary(): TaxBalanceSummary {
  return {
    whtReceivable: 0,
    whtPayable: 0,
    outputVatBundle: 0,
    outputVfrs: 0,
    outputTotal: 0,
    inputTax: 0,
    netVatPosition: 0,
  };
}

/** Sum open ledger amounts. Pass periodMonth to scope to one GRA month bucket. */
export function summarizeOpenTaxBalances(
  entries: TaxLedgerEntry[],
  periodMonth?: string | null,
): TaxBalanceSummary {
  const summary = emptyBalanceSummary();

  for (const entry of entries) {
    if (entry.status !== "open") {
      continue;
    }

    if (periodMonth && entry.period_month.slice(0, 10) !== periodMonth) {
      continue;
    }

    const amount = Number(entry.tax_amount) || 0;

    switch (entry.direction) {
      case "wht_receivable":
        summary.whtReceivable += amount;
        break;
      case "wht_payable":
        summary.whtPayable += amount;
        break;
      case "output":
        summary.outputTotal += amount;
        if (entry.tax_component === "vfrs") {
          summary.outputVfrs += amount;
        } else {
          summary.outputVatBundle += amount;
        }
        break;
      case "input":
        summary.inputTax += amount;
        break;
      default:
        break;
    }
  }

  summary.netVatPosition = summary.outputTotal - summary.inputTax;
  return summary;
}

export function listPeriodMonths(entries: TaxLedgerEntry[]): string[] {
  const months = new Set(entries.map((entry) => entry.period_month.slice(0, 10)));
  return [...months].sort((left, right) => right.localeCompare(left));
}

export function filterTaxLedgerEntries(
  entries: TaxLedgerEntry[],
  filters: TaxLedgerFilters,
): TaxLedgerEntry[] {
  return entries.filter((entry) => {
    if (
      filters.periodMonth &&
      entry.period_month.slice(0, 10) !== filters.periodMonth
    ) {
      return false;
    }

    if (filters.taxComponent && entry.tax_component !== filters.taxComponent) {
      return false;
    }

    if (filters.direction && entry.direction !== filters.direction) {
      return false;
    }

    if (filters.status && entry.status !== filters.status) {
      return false;
    }

    return true;
  });
}

export function daysUntilDate(
  dateValue: string | null | undefined,
  today = new Date(),
): number | null {
  if (!dateValue) {
    return null;
  }

  const due = new Date(`${dateValue.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime())) {
    return null;
  }

  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const diffMs = due.getTime() - start.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export type TaxDueReminder = {
  kind: "vat" | "wht";
  dueDate: string;
  daysUntil: number;
};

export function getUpcomingTaxReminders(
  settings: {
    reminder_enabled: boolean;
    next_vat_due_date: string | null;
    next_wht_due_date: string | null;
  } | null,
  today = new Date(),
  windowDays = REMINDER_WINDOW_DAYS,
): TaxDueReminder[] {
  if (!settings?.reminder_enabled) {
    return [];
  }

  const reminders: TaxDueReminder[] = [];

  const vatDays = daysUntilDate(settings.next_vat_due_date, today);
  if (
    settings.next_vat_due_date &&
    vatDays !== null &&
    vatDays <= windowDays
  ) {
    reminders.push({
      kind: "vat",
      dueDate: settings.next_vat_due_date.slice(0, 10),
      daysUntil: vatDays,
    });
  }

  const whtDays = daysUntilDate(settings.next_wht_due_date, today);
  if (
    settings.next_wht_due_date &&
    whtDays !== null &&
    whtDays <= windowDays
  ) {
    reminders.push({
      kind: "wht",
      dueDate: settings.next_wht_due_date.slice(0, 10),
      daysUntil: whtDays,
    });
  }

  return reminders;
}

export function formatReminderMessage(reminder: TaxDueReminder): string {
  const label = reminder.kind === "vat" ? "VAT return" : "WHT return";
  const dueLabel = formatDate(reminder.dueDate);

  if (reminder.daysUntil < 0) {
    const overdue = Math.abs(reminder.daysUntil);
    return `${label} was due ${dueLabel} (${overdue} day${overdue === 1 ? "" : "s"} overdue).`;
  }

  if (reminder.daysUntil === 0) {
    return `${label} is due today (${dueLabel}).`;
  }

  return `${label} is due in ${reminder.daysUntil} day${reminder.daysUntil === 1 ? "" : "s"} (${dueLabel}).`;
}

/** Append a remittance stamp to notes when marking status='paid'. */
export function appendRemittedNote(
  existingNotes: string | null | undefined,
  remittedOn = new Date(),
): string {
  const stamp = `[Remitted ${remittedOn.toISOString().slice(0, 10)}]`;
  const trimmed = existingNotes?.trim() ?? "";
  if (!trimmed) {
    return stamp;
  }

  if (trimmed.includes("[Remitted ")) {
    return trimmed;
  }

  return `${trimmed} ${stamp}`;
}

export function todayIsoDate(today = new Date()): string {
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
