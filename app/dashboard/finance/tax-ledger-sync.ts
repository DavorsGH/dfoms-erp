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
  | "payroll_period"
  | "fixed_asset";

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
 * Active legs are unique on (tenant_id, source_type, source_id, direction,
 * tax_component) — see tax_ledger_entries_active_source_component_uidx — so
 * insert-then-delete-old is impossible. We use the Postgres RPC
 * replace_income_register_tax_ledger_entries (script 246) so DELETE + INSERT
 * run in one transaction: a failed insert rolls the delete back.
 *
 * RLS still applies (SECURITY INVOKER). No tenant-specific branching.
 */
export async function syncIncomeRegisterTaxLedger(
  supabase: SupabaseClient,
  input: IncomeTaxLedgerInput,
): Promise<{ error: string | null }> {
  const rows = buildIncomeTaxLedgerRows(input);
  const payload = rows.map((row) => ({
    tenant_id: row.tenant_id ?? null,
    entry_date: row.entry_date,
    period_month: row.period_month,
    direction: row.direction,
    tax_component: row.tax_component,
    rate_pct: row.rate_pct,
    taxable_base: row.taxable_base,
    tax_amount: row.tax_amount,
    status: row.status,
    counterparty_name: row.counterparty_name,
    notes: row.notes,
  }));

  const { error } = await supabase.rpc(
    "replace_income_register_tax_ledger_entries",
    {
      p_source_id: input.sourceId,
      p_rows: payload,
    },
  );

  return { error: error?.message ?? null };
}

export type PurchaseTaxLedgerSourceType =
  | "expense_register"
  | "accounts_payable"
  | "fixed_asset";

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
 * Replace tax ledger rows owned by one Expense Register, Accounts Payable,
 * or Fixed Asset purchase entry. Same delete-then-insert contract as
 * syncIncomeRegisterTaxLedger.
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
