import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";

type UpdateLandlordBody = {
  tenant_id?: string;
  landlord_type?: LandlordType;
  management_fee_percent?: number | null;
  paystack_subaccount_code?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateLandlordBody;
  try {
    body = (await request.json()) as UpdateLandlordBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tenantId = body.tenant_id?.trim() ?? "";
  if (!tenantId) {
    return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
  }

  if (tenantId === DAVORS_TENANT_ID) {
    return NextResponse.json(
      { error: "The platform tenant cannot be managed as a landlord." },
      { status: 400 },
    );
  }

  const landlordType = body.landlord_type;
  if (
    landlordType !== "platform_only" &&
    landlordType !== "davors_managed"
  ) {
    return NextResponse.json(
      { error: "landlord_type must be platform_only or davors_managed." },
      { status: 400 },
    );
  }

  let managementFeePercent: number | null = null;
  if (landlordType === "davors_managed") {
    const fee = Number(body.management_fee_percent);
    if (!Number.isFinite(fee) || fee < 0) {
      return NextResponse.json(
        { error: "management_fee_percent must be a non-negative number." },
        { status: 400 },
      );
    }
    managementFeePercent = fee;
  }

  const paystackSubaccountCode =
    typeof body.paystack_subaccount_code === "string"
      ? body.paystack_subaccount_code.trim() || null
      : null;

  const admin = createAdminClient();

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, product_line")
    .eq("id", tenantId)
    .eq("product_line", "real_estate_only")
    .maybeSingle();

  if (tenantError) {
    return NextResponse.json({ error: tenantError.message }, { status: 400 });
  }
  if (!tenant) {
    return NextResponse.json(
      { error: "Landlord tenant not found." },
      { status: 404 },
    );
  }

  const { data: existing, error: existingError } = await admin
    .from("landlords")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }

  const patch = {
    landlord_type: landlordType,
    management_fee_percent:
      landlordType === "davors_managed" ? managementFeePercent : null,
    paystack_subaccount_code: paystackSubaccountCode,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error: updateError } = await admin
      .from("landlords")
      .update(patch)
      .eq("tenant_id", tenantId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }
  } else {
    const { error: insertError } = await admin.from("landlords").insert({
      tenant_id: tenantId,
      approval_status: "pending",
      sms_credit_balance: 0,
      ...patch,
      created_at: new Date().toISOString(),
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true });
}
