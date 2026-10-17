import {
  buildRemitExpenseReceiptNo,
  type RemitTaxKind,
} from "@/app/dashboard/finance/tax-ledger-remit";
import {
  isPaidStatus,
  type BalanceSheetCashExpenseEntry,
} from "@/app/dashboard/finance/accrued-wages-utils";
import type { TaxLedgerSourceType } from "@/app/dashboard/finance/tax-ledger-sync";
import type {
  TaxLedgerComponent,
  TaxLedgerStatus,
} from "@/app/dashboard/finance/tax-ledger-utils";

export type TaxLedgerBsClearanceEntry = {
  id: string;
  entry_date: string;
  period_month: string;
  direction: string;
  tax_component: TaxLedgerComponent;
  tax_amount: number;
  status: TaxLedgerStatus;
  remitted_at?: string | null;
  source_type?: TaxLedgerSourceType | string | null;
  source_id?: string | null;
};

export type TaxLedgerBsClearanceContext = {
  remittanceExpenseDateByReceipt: ReadonlyMap<string, string>;
  expenseDateById: ReadonlyMap<string, string>;
};

export type TaxLedgerClearanceResolution =
  | { kind: "expense_receipt"; date: string }
  | { kind: "linked_expense"; date: string }
  | { kind: "remitted_at_fallback"; date: string };

export type TaxLedgerRemittedAtFallbackRow = {
  tenantId: string;
  id: string;
  tax_component: TaxLedgerComponent;
  period_month: string;
  tax_amount: number;
  remitted_at: string;
};

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function isTaxRemittanceReceipt(receiptNo: string | null | undefined): boolean {
  if (!receiptNo) return false;
  return receiptNo.startsWith("TAX-REMIT-");
}

export function inferRemitKindForTaxLedgerEntry(
  entry: Pick<TaxLedgerBsClearanceEntry, "direction" | "tax_component">,
): RemitTaxKind | null {
  if (entry.direction === "wht_payable") {
    return "wht";
  }
  if (entry.direction === "statutory_payable") {
    if (entry.tax_component === "paye") {
      return "paye";
    }
    if (
      entry.tax_component === "ssnit_employee" ||
      entry.tax_component === "ssnit_employer_tier1" ||
      entry.tax_component === "ssnit_tier2"
    ) {
      return "ssnit";
    }
  }
  if (entry.direction === "output" || entry.direction === "input") {
    if (entry.tax_component === "vat_bundle" || entry.tax_component === "vfrs") {
      return "vat";
    }
  }
  return null;
}

export function buildTaxLedgerBsClearanceContext(
  cashFlowExpenseEntries: ReadonlyArray<
    Pick<
      BalanceSheetCashExpenseEntry,
      "date" | "payment_status" | "receipt_no"
    > & { id?: string | null }
  >,
): TaxLedgerBsClearanceContext {
  const remittanceExpenseDateByReceipt = new Map<string, string>();
  const expenseDateById = new Map<string, string>();

  for (const row of cashFlowExpenseEntries) {
    if (!isPaidStatus(row.payment_status)) {
      continue;
    }
    const date = normalizeDate(row.date);
    if (row.id) {
      expenseDateById.set(String(row.id), date);
    }
    const receipt = row.receipt_no?.trim();
    if (receipt && isTaxRemittanceReceipt(receipt)) {
      remittanceExpenseDateByReceipt.set(receipt, date);
    }
  }

  return { remittanceExpenseDateByReceipt, expenseDateById };
}

export function resolveTaxLedgerClearanceDate(
  entry: TaxLedgerBsClearanceEntry,
  context: TaxLedgerBsClearanceContext,
): TaxLedgerClearanceResolution | null {
  if (entry.status !== "paid") {
    return null;
  }

  const remitKind = inferRemitKindForTaxLedgerEntry(entry);
  const periodMonth = entry.period_month?.slice(0, 10) ?? null;
  if (remitKind && periodMonth && entry.id) {
    const legReceipt = `${buildRemitExpenseReceiptNo(remitKind, periodMonth)}-LEG-${entry.id.slice(0, 8)}`;
    const legDate = context.remittanceExpenseDateByReceipt.get(legReceipt);
    if (legDate) {
      return { kind: "expense_receipt", date: legDate };
    }
    const periodReceipt = buildRemitExpenseReceiptNo(remitKind, periodMonth);
    const periodDate = context.remittanceExpenseDateByReceipt.get(periodReceipt);
    if (periodDate) {
      return { kind: "expense_receipt", date: periodDate };
    }
  }

  const sourceType = entry.source_type ?? null;
  const sourceId = entry.source_id?.trim() ?? null;
  if (
    sourceId &&
    (sourceType === "expense_register" ||
      sourceType === "settlement" ||
      entry.direction === "settlement")
  ) {
    const linked = context.expenseDateById.get(sourceId);
    if (linked) {
      return { kind: "linked_expense", date: linked };
    }
  }

  if (entry.remitted_at) {
    return {
      kind: "remitted_at_fallback",
      date: normalizeDate(entry.remitted_at),
    };
  }

  return null;
}

export function isTaxLedgerAmountOpenAsOfMonthEndWithClearance(
  entry: TaxLedgerBsClearanceEntry,
  monthEnd: string,
  context: TaxLedgerBsClearanceContext,
): boolean {
  const entryDate = normalizeDate(entry.entry_date);
  if (!entryDate || entryDate > monthEnd) {
    return false;
  }
  if (entry.status === "open") {
    return true;
  }
  if (entry.status === "paid") {
    const cleared = resolveTaxLedgerClearanceDate(entry, context);
    if (!cleared) {
      return false;
    }
    return cleared.date > monthEnd;
  }
  return false;
}

export function collectTaxLedgerRemittedAtFallbackRows(
  tenantId: string,
  entries: ReadonlyArray<TaxLedgerBsClearanceEntry>,
  context: TaxLedgerBsClearanceContext,
): TaxLedgerRemittedAtFallbackRow[] {
  const out: TaxLedgerRemittedAtFallbackRow[] = [];
  for (const entry of entries) {
    if (entry.status !== "paid") {
      continue;
    }
    const resolved = resolveTaxLedgerClearanceDate(entry, context);
    if (resolved?.kind !== "remitted_at_fallback") {
      continue;
    }
    out.push({
      tenantId,
      id: entry.id,
      tax_component: entry.tax_component,
      period_month: entry.period_month?.slice(0, 10) ?? entry.entry_date.slice(0, 10),
      tax_amount: Number(entry.tax_amount) || 0,
      remitted_at: resolved.date,
    });
  }
  return out;
}
