import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createOneTimeLeaseCharge } from "@/utils/rent-ledger-one-time";

export const runtime = "nodejs";

type Body = {
  lease_id?: string;
  description?: string;
  amount_ghs?: number | string;
  charge_date?: string;
};

/**
 * platform_only landlords only: create a one-time charge on their lease.
 * davors_managed landlords are blocked (staff creates on their behalf).
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const amount = Number(body.amount_ghs);

  try {
    const result = await createOneTimeLeaseCharge(admin, {
      tenantId: auth.session.tenantId,
      leaseId,
      description: body.description ?? "",
      amountGhs: amount,
      chargeDate: body.charge_date,
    });

    return NextResponse.json({
      success: true,
      entry_id: result.entryId,
      amount_due_ghs: result.amountDueGhs,
      description: result.description,
      period_start: result.periodStart,
      period_end: result.periodEnd,
      charge_type: "one_time",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create one-time charge.",
      },
      { status: 400 },
    );
  }
}
