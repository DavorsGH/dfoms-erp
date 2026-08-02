import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ghsToPesewas,
  initializePaystackOneOffTransaction,
} from "@/utils/paystack";
import {
  isValidEmail,
  roundGhs,
} from "@/utils/product-sale-paystack";
import { SMS_CREDIT_PAYSTACK_CONTEXT } from "@/utils/sms-credit-paystack";

export type InitializeSmsCreditPurchaseResult =
  | {
      ok: true;
      purchaseRequestId: string;
      packKey: string;
      credits: number;
      amountGhs: number;
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
  const priceGhs = roundGhs(Number(pack.price_ghs));
  if (!Number.isFinite(credits) || credits <= 0) {
    return {
      ok: false,
      error: "Pack has an invalid credit quantity.",
      status: 400,
    };
  }
  if (!Number.isFinite(priceGhs) || priceGhs <= 0) {
    return {
      ok: false,
      error: "Pack does not have a valid GHS price.",
      status: 400,
    };
  }

  const { data: inserted, error: insertError } = await admin
    .from("sms_credit_purchase_requests")
    .insert({
      tenant_id: tenantId,
      pack_key: pack.pack_key,
      credits_requested: credits,
      amount_requested_ghs: priceGhs,
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

  const initialized = await initializePaystackOneOffTransaction({
    email: billingEmail,
    amountPesewas: ghsToPesewas(priceGhs),
    callbackUrl: options.callbackUrl,
    currency: "GHS",
    channels: ["mobile_money", "card"],
    // No subaccount — SMS credit revenue settles to Davors.
    metadata: {
      context: SMS_CREDIT_PAYSTACK_CONTEXT,
      tenant_id: tenantId,
      purchase_request_id: purchaseRequestId,
      pack_key: pack.pack_key,
      credits,
      amount_ghs: priceGhs,
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
    purchaseRequestId,
    packKey: pack.pack_key as string,
    credits,
    amountGhs: priceGhs,
    reference: initialized.reference,
    accessCode: initialized.accessCode,
    authorizationUrl: initialized.authorizationUrl,
  };
}
