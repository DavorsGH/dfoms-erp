import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isValidEmail, resolveSiteUrlFromRequest } from "@/utils/product-sale-paystack";
import { initializeSmsCreditPurchase } from "@/utils/sms-credit-purchase";

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

  const [{ data: billingSettings }, { data: accountRow }] = await Promise.all([
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

  if (accountRow?.tenant_id && accountRow.tenant_id !== auth.tenantId) {
    return NextResponse.json(
      { error: "Tenant resolution mismatch. Sign out and sign in again." },
      { status: 409 },
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

  const siteUrl = resolveSiteUrlFromRequest(request);
  const callbackUrl = `${siteUrl}/dashboard/administration/billing/callback`;

  const result = await initializeSmsCreditPurchase(admin, {
    tenantId: auth.tenantId,
    packKey,
    billingEmail,
    callbackUrl,
    flow: "billing_sms_credit_inline",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    purchase_request_id: result.purchaseRequestId,
    pack_key: result.packKey,
    credits: result.credits,
    amount_ghs: result.amountGhs,
    reference: result.reference,
    access_code: result.accessCode,
    authorization_url: result.authorizationUrl,
  });
}
