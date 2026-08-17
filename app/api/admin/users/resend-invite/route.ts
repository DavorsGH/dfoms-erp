import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createAndSendStaffPortalInvite } from "@/utils/staff-portal-invite";

type ResendInviteBody = {
  email?: string;
};

/**
 * Re-issue a staff portal invite for a pending email in the caller's tenant.
 * Invalidates any previous unused invite for that email.
 */
export async function POST(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: ResendInviteBody;
  try {
    body = (await request.json()) as ResendInviteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pendingInvite, error: lookupError } = await admin
    .from("staff_portal_invites")
    .select(
      "invite_id, role, employee_id, client_id, used_at, expires_at",
    )
    .eq("tenant_id", auth.tenantId)
    .ilike("email", email)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 400 });
  }

  if (!pendingInvite) {
    return NextResponse.json(
      {
        error:
          "No pending staff invite found for this email. Send a new invite from User Accounts.",
      },
      { status: 404 },
    );
  }

  const { data: siteRows } = await admin
    .from("staff_portal_invite_supervisor_sites")
    .select("site_code")
    .eq("invite_id", pendingInvite.invite_id);

  const result = await createAndSendStaffPortalInvite(admin, {
    tenantId: auth.tenantId,
    email,
    role: pendingInvite.role,
    employee_id: pendingInvite.employee_id,
    client_id: pendingInvite.client_id,
    supervisor_site_codes: (siteRows ?? []).map((row) => row.site_code),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 },
    );
  }

  return NextResponse.json({
    invite_id: result.invite_id,
    message: "Invite email resent.",
  });
}
