import type { SupabaseClient } from "@supabase/supabase-js";

import {
  roundTaxAmount,
  roundTaxRate,
  toPeriodMonth,
  type InputTaxComponent,
  type OutputTaxComponent,
} from "./tax-utils";

export const TAX_LEDGER_TABLE = "tax_ledger_entries";

export type TaxLedgerSourceType =
  | "income_register"
  | "client_invoice"
  | "expense_register"
  | "accounts_payable"
  | "product_sale"
  | "manual"
  | "settlement"
  | "payroll_period";

export type TaxLedgerEntryInsert = {
  tenant_id?: string;
  entry_date: string;
  period_month: string;
  direction:
    | "output"
    | "input"
    | "wht_receivable"
    | "wht_payable"
    | "settlement"
    | "statutory_payable";
  tax_component:
    | "vat_bundle"
    | "vfrs"
    | "wht"
    | "paye"
    | "ssnit_employee"
    | "ssnit_employer_tier1"
    | "ssnit_tier2";
  rate_pct: number | null;
  taxable_base: number;
  tax_amount: number;
  status: "open" | "filed" | "paid" | "reversed";
  source_type: TaxLedgerSourceType;
  source_id: string;
  counterparty_name: string | null;
  notes: string | null;
};

export type IncomeTaxLedgerInput = {
  sourceId: string;
  entryDate: string;
  amount: number;
  whtRatePct: number | null;
  whtAmount: number;
  outputTaxComponent: OutputTaxComponent | null;
  outputTaxRatePct: number | null;
  outputVatAmount: number;
  counterpartyName?: string | null;
  notes?: string | null;
  /** Omit to let the enforce_row_tenant_id() trigger stamp the caller's tenant. */
  tenantId?: string;
};

/**
 * Rows an Income Register entry owes the tax ledger.
 *
 * WHT the customer withheld is a receivable against GRA; the output tax
 * (service vat_bundle or goods VFRS) is a liability booked on the net base.
 * Zero-value legs are skipped so untaxed rows stay out of the ledger.
 */
export function buildIncomeTaxLedgerRows(
  input: IncomeTaxLedgerInput,
): TaxLedgerEntryInsert[] {
  const amount = roundTaxAmount(input.amount);
  const whtAmount = roundTaxAmount(input.whtAmount);
  const outputVatAmount = roundTaxAmount(input.outputVatAmount);
  const periodMonth = toPeriodMonth(input.entryDate);

  const shared = {
    entry_date: input.entryDate,
    period_month: periodMonth,
    status: "open" as const,
    source_type: "income_register" as const,
    source_id: input.sourceId,
    counterparty_name: input.counterpartyName ?? null,
    notes: input.notes ?? null,
    ...(input.tenantId ? { tenant_id: input.tenantId } : {}),
  };

  const rows: TaxLedgerEntryInsert[] = [];

  if (whtAmount > 0) {
    rows.push({
      ...shared,
      direction: "wht_receivable",
      tax_component: "wht",
      rate_pct: input.whtRatePct == null ? null : roundTaxRate(input.whtRatePct),
      taxable_base: amount,
      tax_amount: whtAmount,
    });
  }

  if (input.outputTaxComponent && outputVatAmount > 0) {
    rows.push({
      ...shared,
      direction: "output",
      tax_component: input.outputTaxComponent,
      rate_pct:
        input.outputTaxRatePct == null ? null : roundTaxRate(input.outputTaxRatePct),
      taxable_base: roundTaxAmount(amount - outputVatAmount),
      tax_amount: outputVatAmount,
    });
  }

  return rows;
}

export async function deleteTaxLedgerEntriesForSource(
  supabase: SupabaseClient,
  sourceType: TaxLedgerSourceType,
  sourceId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from(TAX_LEDGER_TABLE)
    .delete()
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);

  return { error: error?.message ?? null };
}

/**
 * Replace the tax ledger rows owned by one Income Register entry.
 *
 * Nothing references tax_ledger_entries.id (script 113 adds no inbound FKs), so
 * delete-then-insert is the simplest way to guarantee no duplicates and to drop
 * a leg that no longer applies — e.g. WHT cleared back to 0 on edit. Deletes and
 * inserts both run through the caller's RLS client, so they stay tenant-scoped.
 */
export async function syncIncomeRegisterTaxLedger(
  supabase: SupabaseClient,
  input: IncomeTaxLedgerInput,
): Promise<{ error: string | null }> {
  // Defense in depth: never write tax legs for non-cash system adjustments.
  const { data: sourceRow, error: sourceError } = await supabase
    .from("income_register")
    .select("is_system_adjustment")
    .eq("id", input.sourceId)
    .maybeSingle();

  if (sourceError) {
    return { error: sourceError.message };
  }

  if (sourceRow?.is_system_adjustment) {
    const { error: deleteError } = await deleteTaxLedgerEntriesForSource(
      supabase,
      "income_register",
      input.sourceId,
    );
    return { error: deleteError };
  }

  const { error: deleteError } = await deleteTaxLedgerEntriesForSource(
    supabase,
    "income_register",
    input.sourceId,
  );

  if (deleteError) {
    return { error: deleteError };
  }

  const rows = buildIncomeTaxLedgerRows(input);
  if (rows.length === 0) {
    return { error: null };
  }

  const { error: insertError } = await supabase
    .from(TAX_LEDGER_TABLE)
    .insert(rows);

  return { error: insertError?.message ?? null };
}

export type PurchaseTaxLedgerSourceType =
  | "expense_register"
  | "accounts_payable";

export type PurchaseTaxLedgerInput = {
  sourceType: PurchaseTaxLedgerSourceType;
  sourceId: string;
  entryDate: string;
  /** Supplier invoice gross before WHT (taxable base for WHT). */
  grossBeforeWht: number;
  whtRatePct: number | null;
  whtAmount: number;
  inputTaxComponent: InputTaxComponent | null;
  inputTaxRatePct: number | null;
  inputVatAmount: number;
  counterpartyName?: string | null;
  notes?: string | null;
  /** Omit to let the enforce_row_tenant_id() trigger stamp the caller's tenant. */
  tenantId?: string;
};

/**
 * Expense Register and Accounts Payable are independent registers. Paying AP
 * moves cash via cumulative amount_paid in the shared cash engine (see
 * cash-movement-utils) — it does not auto-create an expense_register row, so
 * settlement is cash-only and does not double P&L. Each row owns its own
 * tax_ledger_entries via source_type+source_id, so the same real-world payment
 * is only double-counted if a user manually enters tax on both registers for
 * that invoice. Prefer one register per supplier bill.
 *
 * Supplier WHT is Davors' GRA liability (wht_payable). Input VAT is a credit
 * (direction=input), typically vat_bundle.
 */
export function buildPurchaseTaxLedgerRows(
  input: PurchaseTaxLedgerInput,
): TaxLedgerEntryInsert[] {
  const grossBeforeWht = roundTaxAmount(input.grossBeforeWht);
  const whtAmount = roundTaxAmount(input.whtAmount);
  const inputVatAmount = roundTaxAmount(input.inputVatAmount);
  const periodMonth = toPeriodMonth(input.entryDate);

  const shared = {
    entry_date: input.entryDate,
    period_month: periodMonth,
    status: "open" as const,
    source_type: input.sourceType,
    source_id: input.sourceId,
    counterparty_name: input.counterpartyName ?? null,
    notes: input.notes ?? null,
    ...(input.tenantId ? { tenant_id: input.tenantId } : {}),
  };

  const rows: TaxLedgerEntryInsert[] = [];

  if (whtAmount > 0) {
    rows.push({
      ...shared,
      direction: "wht_payable",
      tax_component: "wht",
      rate_pct: input.whtRatePct == null ? null : roundTaxRate(input.whtRatePct),
      taxable_base: grossBeforeWht,
      tax_amount: whtAmount,
    });
  }

  if (input.inputTaxComponent && inputVatAmount > 0) {
    rows.push({
      ...shared,
      direction: "input",
      tax_component: input.inputTaxComponent,
      rate_pct:
        input.inputTaxRatePct == null
          ? null
          : roundTaxRate(input.inputTaxRatePct),
      taxable_base: roundTaxAmount(Math.max(0, grossBeforeWht - inputVatAmount)),
      tax_amount: inputVatAmount,
    });
  }

  return rows;
}

/**
 * Replace tax ledger rows owned by one Expense Register or Accounts Payable entry.
 * Same delete-then-insert contract as syncIncomeRegisterTaxLedger.
 */
export async function syncPurchaseTaxLedger(
  supabase: SupabaseClient,
  input: PurchaseTaxLedgerInput,
): Promise<{ error: string | null }> {
  const { error: deleteError } = await deleteTaxLedgerEntriesForSource(
    supabase,
    input.sourceType,
    input.sourceId,
  );

  if (deleteError) {
    return { error: deleteError };
  }

  const rows = buildPurchaseTaxLedgerRows(input);
  if (rows.length === 0) {
    return { error: null };
  }

  const { error: insertError } = await supabase
    .from(TAX_LEDGER_TABLE)
    .insert(rows);

  return { error: insertError?.message ?? null };
}
