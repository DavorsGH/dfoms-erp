import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { createOneTimeLeaseCharge } from "@/utils/rent-ledger-one-time";
import { isLeaseChargeCategory } from "@/utils/lease-charge-categories";

export const runtime = "nodejs";

type Body = {
  tenant_id?: string;
  lease_id?: string;
  description?: string;
  amount_ghs?: number | string;
  charge_date?: string;
  charge_category?: string;
};

/**
 * Staff: create a one-time lease charge on rent_ledger (any landlord type).
 * davors_managed landlords cannot create these themselves — staff acts on their behalf.
 */
export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
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
  const landlord = await assertRealEstateLandlordTenant(
    admin,
    body.tenant_id ?? "",
  );
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const amount = Number(body.amount_ghs);
  const chargeCategoryRaw = body.charge_category?.trim();
  const chargeCategory =
    chargeCategoryRaw && isLeaseChargeCategory(chargeCategoryRaw)
      ? chargeCategoryRaw
      : null;
  try {
    const result = await createOneTimeLeaseCharge(admin, {
      tenantId: landlord.tenantId,
      leaseId,
      description: body.description ?? "",
      amountGhs: amount,
      chargeDate: body.charge_date,
      chargeCategory,
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
