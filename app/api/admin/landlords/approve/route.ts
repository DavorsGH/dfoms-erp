import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { approveLandlordTenant } from "@/utils/landlord-approval";
import { reactivateLandlordPortalAccess } from "@/utils/landlord-portal-account-management";
import { createAndSendLandlordPortalInvite } from "@/utils/landlord-portal-invite";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

type ApprovalBody = {
  tenant_id?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: ApprovalBody;
  try {
    body = (await request.json()) as ApprovalBody;
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

  const approval = await approveLandlordTenant(admin, tenantId);

  if (!approval.ok) {
    return NextResponse.json(
      { error: approval.error },
      { status: approval.status },
    );
  }

  const { data: landlordRow } = await admin
    .from("landlords")
    .select("auth_user_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const authUserId =
    typeof landlordRow?.auth_user_id === "string"
      ? landlordRow.auth_user_id.trim()
      : "";
  if (authUserId && approval.transitioned) {
    const liftBan = await reactivateLandlordPortalAccess(admin, authUserId);
    if (!liftBan.ok) {
      return NextResponse.json({ error: liftBan.error }, { status: 400 });
    }
  }

  // Best-effort landlord portal invite (do not fail approve on email errors).
  let portalInvite:
    | { status: "sent" }
    | { status: "skipped"; reason: string }
    | { status: "failed"; error: string }
    | undefined;
  try {
    const inviteResult = await createAndSendLandlordPortalInvite(admin, {
      tenantId,
    });
    if (inviteResult.ok) {
      portalInvite =
        inviteResult.status === "sent"
          ? { status: "sent" }
          : { status: "skipped", reason: inviteResult.reason };
    } else {
      portalInvite = { status: "failed", error: inviteResult.error };
    }
  } catch (error) {
    portalInvite = {
      status: "failed",
      error: error instanceof Error ? error.message : "Invite failed.",
    };
  }

  return NextResponse.json({
    success: true,
    approval_status: approval.approvalStatus,
    portal_invite: portalInvite,
  });
}
