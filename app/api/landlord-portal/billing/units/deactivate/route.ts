import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { deactivatePlatformOnlyUnitBilling } from "@/utils/platform-only-unit-billing";

export const runtime = "nodejs";

type DeactivateBody = {
  unit_id?: string;
};

/** platform_only: deactivate unit for billing (no refund; future billing only). */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: DeactivateBody;
  try {
    body = (await request.json()) as DeactivateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const unitId = body.unit_id?.trim() ?? "";
  if (!unitId) {
    return NextResponse.json({ error: "unit_id is required" }, { status: 400 });
  }

  const result = await deactivatePlatformOnlyUnitBilling(
    auth.admin,
    auth.session.tenantId,
    unitId,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, unit_id: unitId, billing_active: false });
}
