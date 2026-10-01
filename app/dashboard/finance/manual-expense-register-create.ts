import type { SupabaseClient } from "@supabase/supabase-js";
import { validateNewExpenseRegisterCategory } from "@/utils/expense-register-category-guard";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import {
  calculateAmount,
  formatGHS,
} from "./expense-register-utils";
import { resolveManualExpenseReceiptNo } from "./expense-register-api";
import {
  computePurchaseTaxAmounts,
  roundTaxAmount,
} from "./tax-utils";
import { syncPurchaseTaxLedger } from "./tax-ledger-sync";
import { validateManualExpenseRegisterPaymentStatusForWrite } from "@/utils/manual-expense-payment-status";

export type ManualExpenseRegisterCreateInput = {
  date: string;
  expense_category: string;
  sub_category: string;
  description: string;
  vendor: string;
  price: number;
  quantity: number;
  payment_method: string;
  approved_by: string;
  receipt_no?: string;
  payment_status: string;
  notes?: string | null;
  business_unit_id: string | null;
  has_wht_vat?: boolean;
  wht_rate?: number;
  wht_amount?: number;
  input_vat_amount?: number;
};

export type ManualExpenseRegisterCreateResult =
  | { ok: true; expenseId: string; ledgerError: string | null }
  | { ok: false; error: string };

export async function createManualExpenseRegisterEntry(
  supabase: SupabaseClient,
  input: ManualExpenseRegisterCreateInput,
): Promise<ManualExpenseRegisterCreateResult> {
  const categoryError = validateNewExpenseRegisterCategory(input.expense_category);
  if (categoryError) {
    return { ok: false, error: categoryError };
  }

  const paymentStatusError = validateManualExpenseRegisterPaymentStatusForWrite(
    input.payment_status,
  );
  if (paymentStatusError) {
    return { ok: false, error: paymentStatusError };
  }

  const vendor = input.vendor.trim();
  if (!vendor) {
    return { ok: false, error: "Supplier is required." };
  }

  const price = Number(input.price);
  const quantity =
    input.quantity == null || !Number.isFinite(input.quantity)
      ? 1
      : input.quantity;
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }

  const grossBeforeWht = calculateAmount(price, quantity);
  const hasWht = input.has_wht_vat ?? false;
  const whtRate = hasWht ? Number(input.wht_rate) || 0 : 0;
  const whtAmount = hasWht
    ? Math.max(0, roundTaxAmount(Number(input.wht_amount) || 0))
    : 0;
  const inputVatAmount = hasWht
    ? Math.max(0, roundTaxAmount(Number(input.input_vat_amount) || 0))
    : 0;

  const purchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht,
    whtRatePct: whtRate,
    whtAmount,
    inputVatAmount,
  });

  const resolvedReceipt = await resolveManualExpenseReceiptNo(
    supabase,
    input.receipt_no ?? "",
  );
  if (resolvedReceipt.error || !resolvedReceipt.receiptNo) {
    return {
      ok: false,
      error: resolvedReceipt.error ?? "Unable to allocate receipt number.",
    };
  }

  const payload = {
    date: input.date,
    expense_category: input.expense_category,
    sub_category: input.sub_category,
    description: input.description || null,
    vendor,
    price,
    quantity,
    amount: purchaseTax.netPaidToSupplier,
    payment_method: input.payment_method,
    approved_by: input.approved_by,
    receipt_no: resolvedReceipt.receiptNo,
    payment_status: input.payment_status,
    gross_before_wht: purchaseTax.grossBeforeWht,
    wht_rate: whtRate > 0 ? whtRate : null,
    wht_amount: purchaseTax.whtAmount,
    input_vat_amount: purchaseTax.inputVatAmount,
    net_of_tax_amount: purchaseTax.netOfTaxAmount,
    notes: input.notes ?? null,
    project_id: null,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("expense_register")
    .insert({
      ...payload,
      business_unit_id: input.business_unit_id,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return {
      ok: false,
      error: insertError?.message ?? "Unable to save the expense entry.",
    };
  }

  const expenseId = (inserted as { id: string }).id;

  requestTenantAdminDirectorNotification({
    title: "New expense recorded",
    detail: formatGHS(purchaseTax.netPaidToSupplier),
    actionUrl: "/dashboard/finance/expenses",
  });

  const { error: ledgerError } = await syncPurchaseTaxLedger(supabase, {
    sourceType: "expense_register",
    sourceId: expenseId,
    entryDate: input.date,
    grossBeforeWht: purchaseTax.grossBeforeWht,
    whtRatePct: whtRate > 0 ? whtRate : null,
    whtAmount: purchaseTax.whtAmount,
    inputTaxComponent: purchaseTax.inputTaxComponent,
    inputTaxRatePct: null,
    inputVatAmount: purchaseTax.inputVatAmount,
    counterpartyName: vendor,
    notes: resolvedReceipt.receiptNo
      ? `Receipt ${resolvedReceipt.receiptNo}`
      : null,
    businessUnitId: input.business_unit_id,
  });

  return {
    ok: true,
    expenseId,
    ledgerError: ledgerError ?? null,
  };
}
