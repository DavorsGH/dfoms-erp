import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { resolveSiteUrlFromRequest } from "@/utils/product-sale-paystack";
import {
  activatePlatformOnlyUnitForBilling,
} from "@/utils/platform-only-unit-billing";

export const runtime = "nodejs";

type ActivateBody = {
  unit_id?: string;
  trigger_type?: "activation" | "reactivation" | "create";
};

/**
 * platform_only: activate unit for metered billing (post-trial per-unit charge).
 * Uses stored Paystack authorization when available; otherwise returns Inline access_code.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: ActivateBody;
  try {
    body = (await request.json()) as ActivateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const unitId = body.unit_id?.trim() ?? "";
  if (!unitId) {
    return NextResponse.json({ error: "unit_id is required" }, { status: 400 });
  }

  const triggerType = body.trigger_type ?? "activation";
  if (
    triggerType !== "activation" &&
    triggerType !== "reactivation" &&
    triggerType !== "create"
  ) {
    return NextResponse.json(
      { error: "trigger_type must be activation, reactivation, or create." },
      { status: 400 },
    );
  }

  const siteUrl = resolveSiteUrlFromRequest(request);
  const callbackUrl = `${siteUrl}/landlord-portal/administration/billing/callback`;

  const result = await activatePlatformOnlyUnitForBilling(auth.admin, {
    tenantId: auth.session.tenantId,
    unitId,
    triggerType,
    billingEmailFallback: auth.session.email,
    callbackUrl,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if ("requiresPayment" in result && result.requiresPayment) {
    return NextResponse.json({
      ok: true,
      requires_payment: true,
      unit_id: unitId,
      amount_ghs: result.amountGhs,
      reference: result.reference,
      access_code: result.accessCode,
    });
  }

  if ("activated" in result && result.activated) {
    return NextResponse.json({
      ok: true,
      activated: true,
      unit_id: unitId,
      trial: result.trial,
      amount_ghs: result.amountGhs,
      reference: result.reference,
      unit_activation_price_ghs: result.amountGhs,
    });
  }

  return NextResponse.json(
    { error: "Unexpected activation result." },
    { status: 500 },
  );
}
