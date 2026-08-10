import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

type ConvertBody = {
  tenant_id?: string;
  management_fee_percent?: number | string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: ConvertBody;
  try {
    body = (await request.json()) as ConvertBody;
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

  const fee = Number(body.management_fee_percent);
  if (!Number.isFinite(fee) || fee < 0) {
    return NextResponse.json(
      {
        error:
          "management_fee_percent is required and must be a non-negative number.",
      },
      { status: 400 },
    );
  }

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

  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id, landlord_type")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (landlordError) {
    return NextResponse.json({ error: landlordError.message }, { status: 400 });
  }
  if (!landlord) {
    return NextResponse.json(
      { error: "Landlord record not found." },
      { status: 404 },
    );
  }
  if (landlord.landlord_type !== "platform_only") {
    return NextResponse.json(
      {
        error:
          "Only platform_only landlords can be converted to Davors-managed.",
      },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();

  const { error: updateError } = await admin
    .from("landlords")
    .update({
      landlord_type: "davors_managed",
      management_fee_percent: fee,
      updated_at: nowIso,
    })
    .eq("tenant_id", tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  // Cancel any still-active platform subscription — no more billing once managed.
  const { error: subscriptionError } = await admin
    .from("landlord_subscriptions")
    .update({
      status: "cancelled",
      updated_at: nowIso,
    })
    .eq("tenant_id", tenantId)
    .in("status", ["trialing", "active", "past_due"]);

  if (subscriptionError) {
    // Landlord type already converted; surface subscription cancel failure clearly.
    return NextResponse.json(
      {
        error: `Landlord converted, but failed to cancel subscription: ${subscriptionError.message}`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    landlord_type: "davors_managed",
    management_fee_percent: fee,
  });
}
