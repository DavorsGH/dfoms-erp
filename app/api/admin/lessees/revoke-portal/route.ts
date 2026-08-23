import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { revokeLesseePortalAccess } from "@/utils/email-reuse";

type Body = {
  tenant_id?: string;
  lessee_id?: string;
};

/**
 * Staff Real Estate: clear lessees.auth_user_id + mark status former.
 * Auth user is kept for sequential email reuse.
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

  const lesseeId = body.lessee_id?.trim() ?? "";
  if (!lesseeId) {
    return NextResponse.json({ error: "lessee_id is required" }, { status: 400 });
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

  const result = await revokeLesseePortalAccess(admin, {
    tenantId: landlord.tenantId,
    lesseeId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 },
    );
  }

  return NextResponse.json({ success: true });
}
