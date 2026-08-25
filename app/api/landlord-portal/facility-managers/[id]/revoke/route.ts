import { NextResponse } from "next/server";
import { requireApprovedLandlordSession } from "@/utils/landlord-portal-auth";

export const runtime = "nodejs";

/**
 * Revoke facility manager access: status=revoked, clear auth_user_id.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApprovedLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { id: facilityManagerId } = await context.params;
  if (!facilityManagerId?.trim()) {
    return NextResponse.json(
      { error: "facility manager id is required" },
      { status: 400 },
    );
  }

  const { data: existing, error: loadError } = await auth.admin
    .from("facility_managers")
    .select("facility_manager_id, status, auth_user_id")
    .eq("tenant_id", auth.session.tenantId)
    .eq("facility_manager_id", facilityManagerId)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Facility manager not found." },
      { status: 404 },
    );
  }
  if (existing.status === "revoked") {
    return NextResponse.json({ ok: true, already_revoked: true });
  }

  const nowIso = new Date().toISOString();
  const priorAuthUserId =
    typeof existing.auth_user_id === "string" ? existing.auth_user_id : null;

  await auth.admin
    .from("facility_manager_portal_invites")
    .update({ used_at: nowIso })
    .eq("tenant_id", auth.session.tenantId)
    .eq("facility_manager_id", facilityManagerId)
    .is("used_at", null);

  const { error: revokeError } = await auth.admin
    .from("facility_managers")
    .update({
      status: "revoked",
      auth_user_id: null,
      revoked_at: nowIso,
      revoked_by_auth_uid: auth.session.authUserId,
      updated_at: nowIso,
    })
    .eq("tenant_id", auth.session.tenantId)
    .eq("facility_manager_id", facilityManagerId);

  if (revokeError) {
    return NextResponse.json({ error: revokeError.message }, { status: 400 });
  }

  if (priorAuthUserId) {
    const { data: stillActive } = await auth.admin
      .from("facility_managers")
      .select("facility_manager_id")
      .eq("auth_user_id", priorAuthUserId)
      .eq("status", "active")
      .maybeSingle();
    if (!stillActive) {
      try {
        const { data: authUser } =
          await auth.admin.auth.admin.getUserById(priorAuthUserId);
        if (authUser.user?.user_metadata?.portal === "facility_manager") {
          await auth.admin.auth.admin.updateUserById(priorAuthUserId, {
            user_metadata: {
              ...authUser.user.user_metadata,
              portal: null,
            },
          });
        }
      } catch {
        // non-fatal
      }
    }
  }

  return NextResponse.json({ ok: true });
}
