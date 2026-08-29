import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { STAFF_BUSINESS_UNIT_SWITCHER_ROLES } from "@/app/dashboard/user-account-role-utils";
import { getCurrentAuthUid } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";

type Body = {
  business_unit_id?: string | null;
};

/**
 * Persist the current staff user's active business-unit context.
 * Body: { business_unit_id: string | null } — null = All Businesses.
 */
export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(STAFF_BUSINESS_UNIT_SWITCHER_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const authUid = await getCurrentAuthUid();
  if (!authUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (rawBody === null || typeof rawBody !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if ("tenant_id" in rawBody) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client" },
      { status: 400 },
    );
  }

  const body = rawBody as Body;
  const rawId = body.business_unit_id;
  if (rawId !== null && rawId !== undefined && typeof rawId !== "string") {
    return NextResponse.json(
      { error: "business_unit_id must be a string or null" },
      { status: 400 },
    );
  }

  const businessUnitId =
    rawId === null || rawId === undefined ? null : rawId.trim() || null;

  const admin = createAdminClient();

  if (businessUnitId) {
    const { data: unit, error: unitError } = await admin
      .from("business_units")
      .select("id, tenant_id, is_active")
      .eq("id", businessUnitId)
      .maybeSingle();

    if (unitError) {
      return NextResponse.json({ error: unitError.message }, { status: 400 });
    }

    if (!unit) {
      return NextResponse.json(
        { error: "Business unit not found" },
        { status: 404 },
      );
    }

    if (unit.tenant_id !== auth.tenantId) {
      return NextResponse.json(
        { error: "Business unit does not belong to your workspace" },
        { status: 403 },
      );
    }

    if (unit.is_active !== true) {
      return NextResponse.json(
        { error: "Business unit is not active" },
        { status: 400 },
      );
    }
  }

  const { data, error } = await admin
    .from("user_accounts")
    .update({ active_business_unit_id: businessUnitId })
    .eq("auth_uid", authUid)
    .eq("tenant_id", auth.tenantId)
    .select("active_business_unit_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  return NextResponse.json({
    active_business_unit_id: data.active_business_unit_id ?? null,
  });
}
