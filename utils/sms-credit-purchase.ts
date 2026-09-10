import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ghsToPesewas,
  initializePaystackOneOffTransaction,
} from "@/utils/paystack";
import {
  applyAccountCredit,
  getTenantCreditBalanceGhs,
  splitChargeWithAccountCredit,
} from "@/utils/account-credit";
import {
  isValidEmail,
  roundGhs,
} from "@/utils/product-sale-paystack";
import { fulfillSmsCreditPurchaseWithAccountCredit } from "@/utils/sms-credit-fulfillment";
import { SMS_CREDIT_PAYSTACK_CONTEXT } from "@/utils/sms-credit-paystack";

export type InitializeSmsCreditPurchaseResult =
  | {
      ok: true;
      creditOnly: true;
      purchaseRequestId: string;
      packKey: string;
      credits: number;
      listPriceGhs: number;
      creditAppliedGhs: number;
      paystackAmountGhs: number;
      reference: string;
      balance: number | null;
      newCreditBalanceGhs: number;
    }
  | {
      ok: true;
      creditOnly: false;
      purchaseRequestId: string;
      packKey: string;
      credits: number;
      listPriceGhs: number;
      creditAppliedGhs: number;
      paystackAmountGhs: number;
      reference: string;
      accessCode: string;
      authorizationUrl: string | null;
    }
  | { ok: false; error: string; status: number };

/**
 * Shared SMS credit pack checkout initialize (Paystack one-off + pending
 * sms_credit_purchase_requests row). Used by staff Billing Settings and
 * landlord-portal Billing Settings — same wallet ledger, different auth.
 */
export async function initializeSmsCreditPurchase(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    packKey: string;
    billingEmail: string;
    callbackUrl: string;
    flow: string;
  },
): Promise<InitializeSmsCreditPurchaseResult> {
  const tenantId = options.tenantId.trim();
  const packKey = options.packKey.trim();
  const billingEmail = options.billingEmail.trim().toLowerCase();

  if (!tenantId) {
    return { ok: false, error: "tenant_id is required.", status: 400 };
  }
  if (!packKey) {
    return { ok: false, error: "pack_key is required.", status: 400 };
  }
  if (!billingEmail || !isValidEmail(billingEmail)) {
    return {
      ok: false,
      error:
        "Set a valid workspace email before buying SMS credits.",
      status: 400,
    };
  }

  const { data: pack, error: packError } = await admin
    .from("sms_credit_packs")
    .select("pack_key, credits, price_ghs, is_active")
    .eq("pack_key", packKey)
    .maybeSingle();

  if (packError) {
    return { ok: false, error: packError.message, status: 400 };
  }

  if (!pack || pack.is_active === false) {
    return {
      ok: false,
      error: "Selected SMS credit pack is not available.",
      status: 404,
    };
  }

  const credits = Number(pack.credits);
  const listPriceGhs = roundGhs(Number(pack.price_ghs));
  if (!Number.isFinite(credits) || credits <= 0) {
    return {
      ok: false,
      error: "Pack has an invalid credit quantity.",
      status: 400,
    };
  }
  if (!Number.isFinite(listPriceGhs) || listPriceGhs <= 0) {
    return {
      ok: false,
      error: "Pack does not have a valid GHS price.",
      status: 400,
    };
  }

  const creditBalanceGhs = await getTenantCreditBalanceGhs(admin, tenantId);
  const chargeSplit = splitChargeWithAccountCredit(listPriceGhs, creditBalanceGhs);

  const { data: inserted, error: insertError } = await admin
    .from("sms_credit_purchase_requests")
    .insert({
      tenant_id: tenantId,
      pack_key: pack.pack_key,
      credits_requested: credits,
      amount_requested_ghs: chargeSplit.paystackAmountGhs,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    return {
      ok: false,
      error:
        insertError?.message ??
        "Failed to create SMS credit purchase request.",
      status: 500,
    };
  }

  const purchaseRequestId = inserted.id as string;

  if (chargeSplit.creditFullyCovers) {
    try {
      const fulfilled = await fulfillSmsCreditPurchaseWithAccountCredit(admin, {
        tenantId,
        purchaseRequestId,
        creditAppliedGhs: chargeSplit.creditAppliedGhs,
      });

      return {
        ok: true,
        creditOnly: true,
        purchaseRequestId,
        packKey: pack.pack_key as string,
        credits,
        listPriceGhs: chargeSplit.listPriceGhs,
        creditAppliedGhs: chargeSplit.creditAppliedGhs,
        paystackAmountGhs: 0,
        reference: fulfilled.reference,
        balance: fulfilled.balance,
        newCreditBalanceGhs: fulfilled.newCreditBalanceGhs,
      };
    } catch (error) {
      await admin
        .from("sms_credit_purchase_requests")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", purchaseRequestId)
        .eq("tenant_id", tenantId);

      const message =
        error instanceof Error ? error.message : "Credit-only SMS purchase failed.";
      return { ok: false, error: message, status: 400 };
    }
  }

  const initialized = await initializePaystackOneOffTransaction({
    email: billingEmail,
    amountPesewas: ghsToPesewas(chargeSplit.paystackAmountGhs),
    callbackUrl: options.callbackUrl,
    currency: "GHS",
    channels: ["mobile_money", "card"],
    metadata: {
      context: SMS_CREDIT_PAYSTACK_CONTEXT,
      tenant_id: tenantId,
      purchase_request_id: purchaseRequestId,
      pack_key: pack.pack_key,
      credits,
      list_price_ghs: chargeSplit.listPriceGhs,
      credit_applied_ghs: chargeSplit.creditAppliedGhs,
      paystack_amount_ghs: chargeSplit.paystackAmountGhs,
      amount_ghs: chargeSplit.paystackAmountGhs,
      flow: options.flow,
    },
  });

  if (!initialized.ok) {
    await admin
      .from("sms_credit_purchase_requests")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchaseRequestId)
      .eq("tenant_id", tenantId);

    return { ok: false, error: initialized.error, status: 502 };
  }

  if (!initialized.accessCode?.trim()) {
    await admin
      .from("sms_credit_purchase_requests")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchaseRequestId)
      .eq("tenant_id", tenantId);

    return {
      ok: false,
      error: "Paystack initialize response missing access_code.",
      status: 502,
    };
  }

  if (chargeSplit.creditAppliedGhs > 0) {
    try {
      await applyAccountCredit(admin, {
        tenantId,
        amountGhs: -chargeSplit.creditAppliedGhs,
        reason: "sms_purchase",
        reference: initialized.reference,
      });
    } catch (error) {
      await admin
        .from("sms_credit_purchase_requests")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", purchaseRequestId)
        .eq("tenant_id", tenantId);

      const message =
        error instanceof Error
          ? error.message
          : "Failed to apply account credit before SMS Paystack checkout.";
      return { ok: false, error: message, status: 400 };
    }
  }

  const { error: updateError } = await admin
    .from("sms_credit_purchase_requests")
    .update({
      paystack_reference: initialized.reference,
      authorization_url: initialized.authorizationUrl,
      status: "sent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", purchaseRequestId)
    .eq("tenant_id", tenantId);

  if (updateError) {
    return {
      ok: false,
      error: `Paystack initialized but failed to store reference: ${updateError.message}`,
      status: 500,
    };
  }

  return {
    ok: true,
    creditOnly: false,
    purchaseRequestId,
    packKey: pack.pack_key as string,
    credits,
    listPriceGhs: chargeSplit.listPriceGhs,
    creditAppliedGhs: chargeSplit.creditAppliedGhs,
    paystackAmountGhs: chargeSplit.paystackAmountGhs,
    reference: initialized.reference,
    accessCode: initialized.accessCode,
    authorizationUrl: initialized.authorizationUrl,
  };
}
