import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { roundGhs } from "@/utils/product-sale-paystack";

export type AccountCreditReason =
  | "referral_reward"
  | "subscription_payment"
  | "sms_purchase"
  | "adjustment";

export type AccountCreditLedgerRow = {
  id: string;
  tenant_id: string;
  delta_ghs: number;
  reason: AccountCreditReason;
  reference: string | null;
  created_at: string;
};

export const ACCOUNT_CREDIT_LEDGER_SELECT =
  "id, tenant_id, delta_ghs, reason, reference, created_at";

export type ChargeCreditSplit = {
  listPriceGhs: number;
  creditBalanceGhs: number;
  creditAppliedGhs: number;
  paystackAmountGhs: number;
  creditFullyCovers: boolean;
};

export async function getTenantCreditBalanceGhs(
  admin: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { data, error } = await admin
    .from("billing_settings")
    .select("credit_balance")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return roundGhs(Number(data?.credit_balance ?? 0));
}

export async function applyAccountCredit(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    amountGhs: number;
    reason: AccountCreditReason;
    reference?: string | null;
  },
): Promise<number> {
  const amountGhs = roundGhs(input.amountGhs);
  if (!Number.isFinite(amountGhs) || amountGhs === 0) {
    throw new Error("apply_account_credit amount must be non-zero.");
  }

  const { data, error } = await admin.rpc("apply_account_credit", {
    p_tenant_id: input.tenantId,
    p_delta_ghs: amountGhs,
    p_reason: input.reason,
    p_reference: input.reference?.trim() || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return roundGhs(Number(data));
}

export function splitChargeWithAccountCredit(
  listPriceGhs: number,
  creditBalanceGhs: number,
): ChargeCreditSplit {
  const listPrice = roundGhs(listPriceGhs);
  const creditBalance = roundGhs(Math.max(0, creditBalanceGhs));

  if (!Number.isFinite(listPrice) || listPrice <= 0) {
    throw new Error("List price must be a positive number.");
  }

  const creditAppliedGhs = roundGhs(Math.min(creditBalance, listPrice));
  const paystackAmountGhs = roundGhs(listPrice - creditAppliedGhs);

  return {
    listPriceGhs: listPrice,
    creditBalanceGhs: creditBalance,
    creditAppliedGhs,
    paystackAmountGhs,
    creditFullyCovers: paystackAmountGhs <= 0,
  };
}

export async function loadAccountCreditLedger(
  admin: SupabaseClient,
  tenantId: string,
  limit = 50,
): Promise<AccountCreditLedgerRow[]> {
  const { data, error } = await admin
    .from("account_credit_ledger")
    .select(ACCOUNT_CREDIT_LEDGER_SELECT)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return ((data as AccountCreditLedgerRow[] | null) ?? []).map((row) => ({
    ...row,
    delta_ghs: roundGhs(Number(row.delta_ghs)),
  }));
}

export function assertPaidAmountMatchesExpected(
  paidAmountGhs: number | null | undefined,
  expectedAmountGhs: number,
  context: string,
): number {
  const paid = roundGhs(Number(paidAmountGhs));
  const expected = roundGhs(expectedAmountGhs);

  if (!Number.isFinite(paid) || paid <= 0) {
    throw new Error(`${context}: paid amount is missing or invalid.`);
  }

  if (Math.abs(paid - expected) > 0.01) {
    throw new Error(
      `${context}: paid GHS ${paid.toFixed(2)} does not match expected GHS ${expected.toFixed(2)}.`,
    );
  }

  return paid;
}
