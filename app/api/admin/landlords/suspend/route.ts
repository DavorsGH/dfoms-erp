import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { suspendLandlordPortalAccess } from "@/utils/landlord-portal-account-management";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

type SuspendBody = {
  tenant_id?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: SuspendBody;
  try {
    body = (await request.json()) as SuspendBody;
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

  const admin = createAdminClient();

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id")
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
    .select("tenant_id, approval_status, auth_user_id")
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

  if (landlord.approval_status === "suspended") {
    return NextResponse.json({
      success: true,
      approval_status: "suspended",
    });
  }

  if (landlord.approval_status !== "approved") {
    return NextResponse.json(
      { error: "Only approved landlords can be suspended." },
      { status: 400 },
    );
  }

  const { error: updateError } = await admin
    .from("landlords")
    .update({
      approval_status: "suspended",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const authUserId =
    typeof landlord.auth_user_id === "string"
      ? landlord.auth_user_id.trim()
      : "";
  if (authUserId) {
    const banResult = await suspendLandlordPortalAccess(admin, authUserId);
    if (!banResult.ok) {
      return NextResponse.json({ error: banResult.error }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true, approval_status: "suspended" });
}
