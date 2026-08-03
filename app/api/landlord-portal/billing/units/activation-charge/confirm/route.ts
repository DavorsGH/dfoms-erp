import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { confirmPlatformOnlyUnitActivationPayment } from "@/utils/platform-only-unit-billing";

export const runtime = "nodejs";

type ConfirmBody = {
  unit_id?: string;
  reference?: string;
};

/**
 * platform_only: after Paystack Inline success, verify payment, store authorization,
 * and activate unit billing. Webhook remains the durable path.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: ConfirmBody;
  try {
    body = (await request.json()) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const unitId = body.unit_id?.trim() ?? "";
  const reference = body.reference?.trim() ?? "";
  if (!unitId || !reference) {
    return NextResponse.json(
      { error: "unit_id and reference are required." },
      { status: 400 },
    );
  }

  const result = await confirmPlatformOnlyUnitActivationPayment(auth.admin, {
    tenantId: auth.session.tenantId,
    unitId,
    reference,
    billingEmailFallback: auth.session.email,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    activated: true,
    unit_id: unitId,
    reference: result.reference,
  });
}
