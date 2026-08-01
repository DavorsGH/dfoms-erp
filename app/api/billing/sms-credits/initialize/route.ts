import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  ghsToPesewas,
  initializePaystackOneOffTransaction,
} from "@/utils/paystack";
import {
  isValidEmail,
  resolveSiteUrlFromRequest,
  roundGhs,
} from "@/utils/product-sale-paystack";
import { SMS_CREDIT_PAYSTACK_CONTEXT } from "@/utils/sms-credit-paystack";

export const runtime = "nodejs";

type InitializeBody = {
  pack_key?: string;
};

/**
 * Billing Settings: initialize a one-off Paystack charge for an SMS credit
 * pack. Revenue settles to Davors (no subaccount). Mirrors POS one-off
 * initialize + pending sms_credit_purchase_requests ledger row.
 */
export async function POST(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: InitializeBody;
  try {
    body = (await request.json()) as InitializeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const packKey =
    typeof body.pack_key === "string" ? body.pack_key.trim() : "";
  if (!packKey) {
    return NextResponse.json({ error: "pack_key is required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const [{ data: pack, error: packError }, { data: billingSettings }, { data: accountRow }] =
    await Promise.all([
      admin
        .from("sms_credit_packs")
        .select("pack_key, credits, price_ghs, is_active")
        .eq("pack_key", packKey)
        .maybeSingle(),
      admin
        .from("billing_settings")
        .select("email_recipient")
        .eq("tenant_id", auth.tenantId)
        .maybeSingle(),
      admin
        .from("user_accounts")
        .select("email, tenant_id")
        .eq("auth_uid", user.id)
        .maybeSingle(),
    ]);

  if (packError) {
    return NextResponse.json({ error: packError.message }, { status: 400 });
  }

  if (!pack || pack.is_active === false) {
    return NextResponse.json(
      { error: "Selected SMS credit pack is not available." },
      { status: 404 },
    );
  }

  if (accountRow?.tenant_id && accountRow.tenant_id !== auth.tenantId) {
    return NextResponse.json(
      { error: "Tenant resolution mismatch. Sign out and sign in again." },
      { status: 409 },
    );
  }

  const credits = Number(pack.credits);
  const priceGhs = roundGhs(Number(pack.price_ghs));
  if (!Number.isFinite(credits) || credits <= 0) {
    return NextResponse.json(
      { error: "Pack has an invalid credit quantity." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(priceGhs) || priceGhs <= 0) {
    return NextResponse.json(
      { error: "Pack does not have a valid GHS price." },
      { status: 400 },
    );
  }

  const billingEmail =
    (typeof billingSettings?.email_recipient === "string"
      ? billingSettings.email_recipient.trim()
      : "") ||
    (typeof accountRow?.email === "string" ? accountRow.email.trim() : "") ||
    (user.email ?? "").trim();

  if (!billingEmail || !isValidEmail(billingEmail)) {
    return NextResponse.json(
      {
        error:
          "Set a valid billing email recipient in Billing Settings before buying SMS credits.",
      },
      { status: 400 },
    );
  }

  const { data: inserted, error: insertError } = await admin
    .from("sms_credit_purchase_requests")
    .insert({
      tenant_id: auth.tenantId,
      pack_key: pack.pack_key,
      credits_requested: credits,
      amount_requested_ghs: priceGhs,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    return NextResponse.json(
      {
        error:
          insertError?.message ?? "Failed to create SMS credit purchase request.",
      },
      { status: 500 },
    );
  }

  const purchaseRequestId = inserted.id as string;
  const siteUrl = resolveSiteUrlFromRequest(request);
  const callbackUrl = `${siteUrl}/dashboard/administration/billing/callback`;

  const initialized = await initializePaystackOneOffTransaction({
    email: billingEmail.trim().toLowerCase(),
    amountPesewas: ghsToPesewas(priceGhs),
    callbackUrl,
    currency: "GHS",
    channels: ["mobile_money", "card"],
    // No subaccount — SMS credit revenue settles to Davors.
    metadata: {
      context: SMS_CREDIT_PAYSTACK_CONTEXT,
      tenant_id: auth.tenantId,
      purchase_request_id: purchaseRequestId,
      pack_key: pack.pack_key,
      credits,
      amount_ghs: priceGhs,
      flow: "billing_sms_credit_inline",
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
      .eq("tenant_id", auth.tenantId);

    return NextResponse.json({ error: initialized.error }, { status: 502 });
  }

  if (!initialized.accessCode?.trim()) {
    await admin
      .from("sms_credit_purchase_requests")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchaseRequestId)
      .eq("tenant_id", auth.tenantId);

    return NextResponse.json(
      { error: "Paystack initialize response missing access_code." },
      { status: 502 },
    );
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
    .eq("tenant_id", auth.tenantId);

  if (updateError) {
    return NextResponse.json(
      {
        error: `Paystack initialized but failed to store reference: ${updateError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    purchase_request_id: purchaseRequestId,
    pack_key: pack.pack_key,
    credits,
    amount_ghs: priceGhs,
    reference: initialized.reference,
    access_code: initialized.accessCode,
    authorization_url: initialized.authorizationUrl,
  });
}
