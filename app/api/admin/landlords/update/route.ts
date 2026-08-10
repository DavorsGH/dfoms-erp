import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import { notifyStaffLandlordPendingApproval } from "@/utils/real-estate-staff-notifications";

type UpdateLandlordBody = {
  tenant_id?: string;
  landlord_type?: LandlordType;
  management_fee_percent?: number | null;
  paystack_subaccount_code?: string | null;
  notification_phone?: string | null;
  /** Reuses tenants.email — notification email for platform_only landlords. */
  notification_email?: string | null;
};

/**
 * Staff update for landlords settings. notification_phone writes both
 * landlords.notification_phone and tenants.phone so profile Phone stays in sync.
 */

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
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

  const notificationPhone =
    typeof body.notification_phone === "string"
      ? body.notification_phone.trim() || null
      : null;

  let notificationEmail: string | null | undefined;
  if (typeof body.notification_email === "string") {
    const trimmed = body.notification_email.trim();
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json(
        { error: "notification_email must be a valid email address." },
        { status: 400 },
      );
    }
    notificationEmail = trimmed || null;
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
    notification_phone: notificationPhone,
    updated_at: new Date().toISOString(),
  };

  // Keep tenants.phone in sync with landlords.notification_phone so profile
  // Phone and Notification phone stay equal (historically two columns).
  const tenantPatch: {
    email?: string | null;
    phone?: string | null;
    updated_at: string;
  } = {
    phone: notificationPhone,
    updated_at: new Date().toISOString(),
  };
  if (notificationEmail !== undefined) {
    tenantPatch.email = notificationEmail;
  }

  const { error: tenantUpdateError } = await admin
    .from("tenants")
    .update(tenantPatch)
    .eq("id", tenantId);

  if (tenantUpdateError) {
    return NextResponse.json(
      { error: tenantUpdateError.message },
      { status: 400 },
    );
  }

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

    await notifyStaffLandlordPendingApproval({
      landlordTenantId: tenantId,
      landlordType,
    });
  }

  return NextResponse.json({ success: true });
}
