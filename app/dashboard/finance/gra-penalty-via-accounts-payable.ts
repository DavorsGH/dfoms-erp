import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateBalanceDue,
  calculateDaysOutstanding,
  calculateStatus,
} from "./accounts-payable-utils";
import { buildPurchaseTaxLedgerRpcPayload } from "./tax-ledger-sync";
import { computePurchaseTaxAmounts, roundTaxAmount } from "./tax-utils";
import type { GraReconciliationKind } from "./statutory-due-rules";

export type CreateGraPenaltyViaApInput = {
  supabase: SupabaseClient;
  tenantId: string;
  businessUnitId: string | null;
  kind: GraReconciliationKind;
  periodMonth: string;
  invoiceDate: string;
  vendorName: string;
  expenseCategory: string;
  subCategory: string;
  description: string;
  penaltyAmount: number;
};

export type CreateGraPenaltyViaApResult =
  | { ok: true; apId: string; expenseId: string }
  | { ok: false; error: string };

export function buildGraPenaltyApInvoiceNumber(
  kind: GraReconciliationKind,
  periodMonth: string,
): string {
  const periodKey = periodMonth.slice(0, 7).replace("-", "");
  return `GRA-${kind.toUpperCase()}-PEN-${periodKey}`;
}

export async function createGraPenaltyViaAccountsPayable(
  input: CreateGraPenaltyViaApInput,
): Promise<CreateGraPenaltyViaApResult> {
  const grossBeforeWht = input.penaltyAmount;
  const purchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht,
    whtRatePct: 0,
    whtAmount: 0,
    inputVatAmount: 0,
  });
  const amount = purchaseTax.netPaidToSupplier;
  const invoiceDate = input.invoiceDate.slice(0, 10);
  // GRA penalty payables are due on the invoice date (payable immediately).
  const dueDate = invoiceDate;
  const balanceDue = calculateBalanceDue(amount, 0);
  const daysOutstanding = calculateDaysOutstanding(dueDate);
  const status = calculateStatus(balanceDue, daysOutstanding);
  const invoiceNumber = buildGraPenaltyApInvoiceNumber(
    input.kind,
    input.periodMonth,
  );

  const taxRows = buildPurchaseTaxLedgerRpcPayload({
    sourceType: "accounts_payable",
    sourceId: "00000000-0000-4000-8000-000000000001",
    entryDate: invoiceDate,
    grossBeforeWht: purchaseTax.grossBeforeWht,
    whtRatePct: null,
    whtAmount: 0,
    inputTaxComponent: purchaseTax.inputTaxComponent,
    inputTaxRatePct: null,
    inputVatAmount: 0,
    counterpartyName: input.vendorName,
    notes: invoiceNumber,
    businessUnitId: input.businessUnitId,
  });

  const { data, error } = await input.supabase.rpc("save_accounts_payable", {
    p_tenant_id: input.tenantId,
    p_ap_id: null,
    p_business_unit_id: input.businessUnitId,
    p_vendor_name: input.vendorName,
    p_invoice_number: invoiceNumber,
    p_expense_category: input.expenseCategory,
    p_sub_category: input.subCategory,
    p_description: input.description,
    p_invoice_date: invoiceDate,
    p_due_date: dueDate,
    p_amount: amount,
    p_amount_paid: 0,
    p_balance_due: balanceDue,
    p_status: status,
    p_gross_before_wht: roundTaxAmount(purchaseTax.grossBeforeWht),
    p_wht_rate: null,
    p_wht_amount: 0,
    p_input_vat_amount: 0,
    p_net_of_tax_amount: roundTaxAmount(purchaseTax.netOfTaxAmount),
    p_notes: "GRA reconciliation penalty — payable via Accounts Payable.",
    p_source_type: null,
    p_tax_rows: taxRows,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = data as {
    id?: string;
    accrualExpenseId?: string;
  } | null;

  const apId = payload?.id?.trim();
  const expenseId = payload?.accrualExpenseId?.trim();

  if (!apId || !expenseId) {
    return {
      ok: false,
      error:
        "Payable was saved but the matching accrual expense id was not returned.",
    };
  }

  return { ok: true, apId, expenseId };
}
