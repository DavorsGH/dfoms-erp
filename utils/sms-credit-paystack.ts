import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import { roundGhs } from "@/utils/product-sale-paystack";

export const SMS_CREDIT_PAYSTACK_CONTEXT = "sms_credit" as const;

export type SmsCreditPackRow = {
  pack_key: string;
  credits: number;
  price_ghs: number;
  is_active: boolean;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataObject(data: JsonRecord): JsonRecord {
  let meta: JsonRecord | null = null;
  const raw = data.metadata;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        meta = asRecord(JSON.parse(trimmed));
      } catch {
        meta = null;
      }
    }
  } else {
    meta = asRecord(raw);
  }

  return meta ?? {};
}

export function isSmsCreditPaystackContext(data: JsonRecord): boolean {
  const meta = metadataObject(data);
  return asString(meta.context) === SMS_CREDIT_PAYSTACK_CONTEXT;
}

type PurchaseRequestRow = {
  id: string;
  tenant_id: string;
  pack_key: string;
  credits_requested: number;
  amount_requested_ghs: number;
  paystack_reference: string | null;
  status: string;
};

export type FulfillSmsCreditPurchaseResult = {
  alreadyFulfilled: boolean;
  purchaseRequestId: string;
  tenantId: string;
  credits: number;
  balance: number | null;
};

async function loadPurchaseRequest(
  admin: SupabaseClient,
  options: {
    purchaseRequestId?: string | null;
    reference?: string | null;
    tenantId?: string | null;
  },
): Promise<PurchaseRequestRow | null> {
  let query = admin
    .from("sms_credit_purchase_requests")
    .select(
      "id, tenant_id, pack_key, credits_requested, amount_requested_ghs, paystack_reference, status",
    );

  if (options.purchaseRequestId?.trim()) {
    query = query.eq("id", options.purchaseRequestId.trim());
  } else if (options.reference?.trim()) {
    query = query.eq("paystack_reference", options.reference.trim());
  } else {
    return null;
  }

  if (options.tenantId?.trim()) {
    query = query.eq("tenant_id", options.tenantId.trim());
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as PurchaseRequestRow | null) ?? null;
}

async function loadWalletBalance(
  admin: SupabaseClient,
  tenantId: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from("sms_credit_wallets")
    .select("balance")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error(
      `[sms-credit-paystack] wallet balance lookup failed for ${tenantId}:`,
      error.message,
    );
    return null;
  }

  if (data?.balance == null) {
    return 0;
  }

  return Number(data.balance) || 0;
}

/**
 * Apply a verified Paystack charge to the tenant SMS wallet.
 * Idempotent via purchase-request status='paid' (credit_sms_purchase itself
 * is not idempotent — do not call it when already paid).
 */
export async function fulfillSmsCreditPurchase(
  admin: SupabaseClient,
  options: {
    purchaseRequestId?: string | null;
    reference: string;
    paidAmountGhs: number | null;
    paidAt: string | null;
    metadataTenantId?: string | null;
  },
): Promise<FulfillSmsCreditPurchaseResult> {
  const reference = options.reference.trim();
  if (!reference) {
    throw new Error("Missing Paystack reference.");
  }

  const requestRow = await loadPurchaseRequest(admin, {
    purchaseRequestId: options.purchaseRequestId,
    reference: options.purchaseRequestId ? null : reference,
    tenantId: options.metadataTenantId,
  });

  if (!requestRow) {
    throw new Error("SMS credit purchase request not found for this payment.");
  }

  if (
    options.metadataTenantId &&
    requestRow.tenant_id !== options.metadataTenantId
  ) {
    throw new Error("SMS credit purchase tenant_id metadata mismatch.");
  }

  if (
    requestRow.paystack_reference &&
    requestRow.paystack_reference !== reference
  ) {
    throw new Error("Paystack reference does not match the purchase request.");
  }

  const purchaseRequestId = requestRow.id;
  const tenantId = requestRow.tenant_id;
  const requestStatus = requestRow.status;
  const credits = Number(requestRow.credits_requested);
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new Error("Purchase request has invalid credits_requested.");
  }

  const nowIso = options.paidAt?.trim() || new Date().toISOString();
  const paidAmount =
    options.paidAmountGhs != null
      ? roundGhs(options.paidAmountGhs)
      : roundGhs(Number(requestRow.amount_requested_ghs) || 0);

  async function markPaidIfNeeded(currentStatus: string) {
    if (currentStatus === "paid") {
      return;
    }
    const { error: updateError } = await admin
      .from("sms_credit_purchase_requests")
      .update({
        status: "paid",
        paystack_reference: reference,
        paid_amount_ghs: paidAmount,
        paid_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", purchaseRequestId)
      .eq("tenant_id", tenantId)
      .neq("status", "paid");

    if (updateError) {
      throw new Error(
        `Failed to mark SMS credit purchase paid: ${updateError.message}`,
      );
    }
  }

  if (requestStatus === "paid") {
    const balance = await loadWalletBalance(admin, tenantId);
    return {
      alreadyFulfilled: true,
      purchaseRequestId,
      tenantId,
      credits,
      balance,
    };
  }

  // Guard confirm+webhook races: credit_sms_purchase is not idempotent.
  const { data: existingTxn, error: txnLookupError } = await admin
    .from("sms_credit_transactions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("reason", "purchase")
    .eq("reference", reference)
    .maybeSingle();

  if (txnLookupError) {
    throw new Error(txnLookupError.message);
  }

  if (existingTxn) {
    await markPaidIfNeeded(requestStatus);
    const balance = await loadWalletBalance(admin, tenantId);
    return {
      alreadyFulfilled: true,
      purchaseRequestId,
      tenantId,
      credits,
      balance,
    };
  }

  const { error: creditError } = await admin.rpc("credit_sms_purchase", {
    p_tenant_id: tenantId,
    p_credits: credits,
    p_reference: reference,
  });

  if (creditError) {
    throw new Error(`credit_sms_purchase failed: ${creditError.message}`);
  }

  await markPaidIfNeeded(requestStatus);

  const balance = await loadWalletBalance(admin, tenantId);

  return {
    alreadyFulfilled: false,
    purchaseRequestId,
    tenantId,
    credits,
    balance,
  };
}

/**
 * Webhook path for charge.success with metadata.context === sms_credit.
 */
export async function processSmsCreditPaystackEvent(
  data: JsonRecord,
): Promise<{ detail: string; ignored?: boolean }> {
  const meta = metadataObject(data);
  const reference = asString(data.reference);
  const purchaseRequestId = asString(meta.purchase_request_id);
  const metadataTenantId = asString(meta.tenant_id);
  const amountPesewas = asNumber(data.amount);
  const paidAmountGhs =
    amountPesewas != null ? roundGhs(amountPesewas / 100) : null;
  const paidAt =
    asString(data.paid_at) ?? asString(data.paidAt) ?? new Date().toISOString();

  if (!reference) {
    return {
      ignored: true,
      detail: "sms_credit charge.success missing reference — ignored.",
    };
  }

  const admin = createAdminClient();

  try {
    const result = await fulfillSmsCreditPurchase(admin, {
      purchaseRequestId,
      reference,
      paidAmountGhs,
      paidAt,
      metadataTenantId,
    });

    return {
      detail: `sms_credit charge.success ${result.alreadyFulfilled ? "idempotent" : "credited"} request ${result.purchaseRequestId} (+${result.credits} credits, ref=${reference}).`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown SMS credit fulfillment error";
    throw new Error(`sms_credit fulfillment failed: ${message}`);
  }
}
