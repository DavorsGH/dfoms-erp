import { NextResponse } from "next/server";
import { requireApprovedLandlordSession } from "@/utils/landlord-portal-auth";
import { switchPlatformOnlyLandlordBillingCycle } from "@/utils/platform-only-unit-billing-cycle";

export const runtime = "nodejs";

type SwitchBody = {
  target_cycle?: string;
};

export async function POST(request: Request) {
  const auth = await requireApprovedLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  if (auth.session.landlordType !== "platform_only") {
    return NextResponse.json(
      { error: "Billing cycle switches are only for platform-only landlords." },
      { status: 403 },
    );
  }

  let body: SwitchBody;
  try {
    body = (await request.json()) as SwitchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const targetCycle =
    typeof body.target_cycle === "string" ? body.target_cycle.trim() : "";
  if (targetCycle !== "monthly" && targetCycle !== "annual") {
    return NextResponse.json(
      { error: "target_cycle must be 'monthly' or 'annual'." },
      { status: 400 },
    );
  }

  const result = await switchPlatformOnlyLandlordBillingCycle(
    auth.admin,
    auth.session.tenantId,
    targetCycle,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    billing_cycle: result.billingCycle,
    pending_billing_cycle: result.pendingBillingCycle,
    effective_date: result.effectiveDate,
    charged: result.charged,
    amount_ghs: result.amountGhs,
    reference: result.reference,
    message: result.message,
  });
}
