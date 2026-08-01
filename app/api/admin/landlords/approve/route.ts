import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

type ApprovalBody = {
  tenant_id?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
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

  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id, approval_status")
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
  if (landlord.approval_status !== "pending") {
    return NextResponse.json(
      { error: "Only pending landlords can be approved or rejected." },
      { status: 400 },
    );
  }

  const { error: updateError } = await admin
    .from("landlords")
    .update({
      approval_status: "approved",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  // Best-effort landlord portal invite (do not fail approve on email errors).
  let portalInvite:
    | { status: "sent" }
    | { status: "skipped"; reason: string }
    | { status: "failed"; error: string }
    | undefined;
  try {
    const { createAndSendLandlordPortalInvite } = await import(
      "@/utils/landlord-portal-invite"
    );
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
    approval_status: "approved",
    portal_invite: portalInvite,
  });
}
