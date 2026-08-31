/**
 * Auto-post Accrued expense_register rows for operating Accounts Payable creates
 * so the Balance Sheet stays in balance (liability + matching P&L expense).
 *
 * Tax ledger legs stay owned by accounts_payable via syncPurchaseTaxLedger —
 * this helper must NOT sync tax for the expense row.
 *
 * Cash settlement stays on accounts_payable_payments only; Record Payment must
 * never mark these accrual expenses Paid.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStatutoryRemittancePayable } from "./balance-sheet-ap-cash-utils";
import { normalizeCategoryName } from "./profit-loss-utils";
import {
  EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
  PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
  PAYROLL_EXPENSE_PAYMENT_METHOD_ACCRUAL,
  PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
} from "../hr-payroll/payroll-lock-finance-utils";

export const AP_ACCRUAL_RECEIPT_PREFIX = "AP-ACCRUAL-";
export const AP_ACCRUAL_DESCRIPTION_PREFIX =
  "Auto-posted from Accounts Payable";

export type AccountsPayableAccrualSource = {
  id: string;
  vendor_name: string;
  invoice_number?: string | null;
  expense_category?: string | null;
  sub_category?: string | null;
  invoice_date: string;
  due_date?: string | null;
  /** Vendor liability = gross − WHT (accounts_payable.amount). */
  amount: number;
  net_of_tax_amount?: number | null;
  gross_before_wht?: number | null;
  wht_rate?: number | null;
  wht_amount?: number | null;
  input_vat_amount?: number | null;
  business_unit_id?: string | null;
  source_type?: string | null;
  notes?: string | null;
};

export type PostAccountsPayableAccrualResult =
  | { status: "skipped"; reason: string }
  | {
      status: "inserted" | "updated" | "unchanged";
      expenseId: string;
      receiptNo: string;
    };

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildAccountsPayableAccrualReceiptNo(
  accountsPayableId: string,
): string {
  return `${AP_ACCRUAL_RECEIPT_PREFIX}${accountsPayableId}`;
}

export function buildAccountsPayableAccrualDescription(input: {
  vendorName: string;
  invoiceNumber?: string | null;
}): string {
  const vendor = input.vendorName.trim() || "Vendor";
  const invoice = (input.invoiceNumber ?? "").trim() || "—";
  return `${AP_ACCRUAL_DESCRIPTION_PREFIX} — ${vendor} — Inv ${invoice}`;
}

/**
 * Fixed-asset credit purchases are balanced by the asset, not by operating expense.
 */
export function isFixedAssetCreditPayable(entry: {
  source_type?: string | null;
  invoice_number?: string | null;
  expense_category?: string | null;
}): boolean {
  if ((entry.source_type ?? "").trim().toLowerCase() === "fixed_asset") {
    return true;
  }

  const invoice = (entry.invoice_number ?? "").trim().toUpperCase();
  if (invoice.startsWith("FAP-")) {
    return true;
  }

  const category = normalizeCategoryName(entry.expense_category ?? "");
  return category === normalizeCategoryName("Fixed Assets");
}

export function shouldPostAccountsPayableAccrualExpense(entry: {
  source_type?: string | null;
  vendor_name?: string | null;
  invoice_number?: string | null;
  expense_category?: string | null;
}): boolean {
  if (isFixedAssetCreditPayable(entry)) {
    return false;
  }
  if (isStatutoryRemittancePayable(entry)) {
    return false;
  }
  return true;
}

function resolveAccrualPaymentStatus(expenseCategory: string | null | undefined): string {
  if (
    normalizeCategoryName(expenseCategory ?? "") ===
    normalizeCategoryName(PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES)
  ) {
    return EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH;
  }
  return PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED;
}

function buildAccrualPayload(
  entry: AccountsPayableAccrualSource,
  tenantId: string | undefined,
) {
  const receiptNo = buildAccountsPayableAccrualReceiptNo(entry.id);
  const amount = roundCurrency(Number(entry.amount) || 0);
  const netOfTax =
    entry.net_of_tax_amount != null
      ? roundCurrency(Number(entry.net_of_tax_amount) || 0)
      : amount;
  const grossBeforeWht =
    entry.gross_before_wht != null
      ? roundCurrency(Number(entry.gross_before_wht) || 0)
      : amount;
  const whtAmount = roundCurrency(Number(entry.wht_amount) || 0);
  const inputVatAmount = roundCurrency(Number(entry.input_vat_amount) || 0);
  const whtRate = entry.wht_rate != null ? Number(entry.wht_rate) || 0 : null;

  return {
    ...(tenantId ? { tenant_id: tenantId } : {}),
    date: entry.invoice_date,
    expense_category: entry.expense_category?.trim() || "Administrative",
    sub_category: entry.sub_category?.trim() || "General",
    description: buildAccountsPayableAccrualDescription({
      vendorName: entry.vendor_name,
      invoiceNumber: entry.invoice_number,
    }),
    vendor: entry.vendor_name.trim() || null,
    price: grossBeforeWht,
    quantity: 1,
    amount,
    payment_method: PAYROLL_EXPENSE_PAYMENT_METHOD_ACCRUAL,
    approved_by: "System",
    receipt_no: receiptNo,
    payment_status: resolveAccrualPaymentStatus(entry.expense_category),
    gross_before_wht: grossBeforeWht,
    wht_rate: whtRate != null && whtRate > 0 ? whtRate : null,
    wht_amount: whtAmount,
    input_vat_amount: inputVatAmount,
    net_of_tax_amount: netOfTax,
    notes:
      "Non-cash AP accrual; cash settles only via Accounts Payable Record Payment. Do not Mark Paid.",
    business_unit_id: entry.business_unit_id ?? null,
  };
}

/**
 * Upsert the Accrued expense_register row for an operating AP entry.
 * Skips Fixed Asset credit and statutory remittance payables.
 */
export async function postAccountsPayableAccrualExpense(
  supabase: SupabaseClient,
  entry: AccountsPayableAccrualSource,
  options?: { tenantId?: string },
): Promise<PostAccountsPayableAccrualResult> {
  if (!shouldPostAccountsPayableAccrualExpense(entry)) {
    return {
      status: "skipped",
      reason: isFixedAssetCreditPayable(entry)
        ? "fixed_asset_credit"
        : "statutory_remittance",
    };
  }

  const tenantId = options?.tenantId;
  const payload = buildAccrualPayload(entry, tenantId);
  const receiptNo = payload.receipt_no;

  let existingQuery = supabase
    .from("expense_register")
    .select("id, amount, net_of_tax_amount, payment_status, expense_category, description, date")
    .eq("receipt_no", receiptNo);

  if (tenantId) {
    existingQuery = existingQuery.eq("tenant_id", tenantId);
  }

  const { data: existing, error: selectError } = await existingQuery.maybeSingle();

  if (selectError) {
    throw new Error(selectError.message);
  }

  if (existing) {
    const needsUpdate =
      Number(existing.amount) !== Number(payload.amount) ||
      Number(existing.net_of_tax_amount ?? 0) !==
        Number(payload.net_of_tax_amount) ||
      existing.expense_category !== payload.expense_category ||
      existing.description !== payload.description ||
      existing.date !== payload.date;

    if (!needsUpdate) {
      return {
        status: "unchanged",
        expenseId: existing.id as string,
        receiptNo,
      };
    }

    // Preserve payment_status on sync (Accrued vs Settled staff-salaries guard
    // only applies on insert). Record Payment must not flip this either.
    const { error: updateError } = await supabase
      .from("expense_register")
      .update({
        date: payload.date,
        expense_category: payload.expense_category,
        sub_category: payload.sub_category,
        description: payload.description,
        vendor: payload.vendor,
        price: payload.price,
        quantity: payload.quantity,
        amount: payload.amount,
        payment_method: payload.payment_method,
        approved_by: payload.approved_by,
        gross_before_wht: payload.gross_before_wht,
        wht_rate: payload.wht_rate,
        wht_amount: payload.wht_amount,
        input_vat_amount: payload.input_vat_amount,
        net_of_tax_amount: payload.net_of_tax_amount,
        notes: payload.notes,
        business_unit_id: payload.business_unit_id,
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return {
      status: "updated",
      expenseId: existing.id as string,
      receiptNo,
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("expense_register")
    .insert(payload)
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? "Unable to post AP accrual expense.");
  }

  return {
    status: "inserted",
    expenseId: (inserted as { id: string }).id,
    receiptNo,
  };
}

/**
 * Delete the auto-posted accrual expense for an AP id (idempotent).
 */
export async function deleteAccountsPayableAccrualExpense(
  supabase: SupabaseClient,
  accountsPayableId: string,
  options?: { tenantId?: string },
): Promise<{ deleted: number; receiptNo: string }> {
  const receiptNo = buildAccountsPayableAccrualReceiptNo(accountsPayableId);

  let selectQuery = supabase
    .from("expense_register")
    .select("id")
    .eq("receipt_no", receiptNo);

  if (options?.tenantId) {
    selectQuery = selectQuery.eq("tenant_id", options.tenantId);
  }

  const { data: rows, error: selectError } = await selectQuery;

  if (selectError) {
    throw new Error(selectError.message);
  }

  const ids = (rows ?? []).map((row) => row.id as string);
  if (ids.length === 0) {
    return { deleted: 0, receiptNo };
  }

  let deleteQuery = supabase.from("expense_register").delete().in("id", ids);
  if (options?.tenantId) {
    deleteQuery = deleteQuery.eq("tenant_id", options.tenantId);
  }

  const { error: deleteError } = await deleteQuery;
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  return { deleted: ids.length, receiptNo };
}
