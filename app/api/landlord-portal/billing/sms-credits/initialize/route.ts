import { NextResponse } from "next/server";
import { requireApprovedLandlordSession } from "@/utils/landlord-portal-auth";
import { resolveSiteUrlFromRequest } from "@/utils/product-sale-paystack";
import { initializeSmsCreditPurchase } from "@/utils/sms-credit-purchase";

export const runtime = "nodejs";

type InitializeBody = {
  pack_key?: string;
};

/**
 * Landlord portal: initialize Paystack Inline SMS credit purchase for the
 * signed-in landlord's tenant_id wallet (same ledger as staff Billing).
 */
export async function POST(request: Request) {
  const auth = await requireApprovedLandlordSession();
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

  const { data: tenant } = await auth.admin
    .from("tenants")
    .select("email")
    .eq("id", auth.session.tenantId)
    .maybeSingle();

  const billingEmail =
    (typeof tenant?.email === "string" ? tenant.email.trim() : "") ||
    (auth.session.email?.trim() ?? "");

  const siteUrl = resolveSiteUrlFromRequest(request);
  const callbackUrl = `${siteUrl}/landlord-portal/administration/billing/callback`;

  const result = await initializeSmsCreditPurchase(auth.admin, {
    tenantId: auth.session.tenantId,
    packKey,
    billingEmail,
    callbackUrl,
    flow: "landlord_portal_sms_credit_inline",
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
