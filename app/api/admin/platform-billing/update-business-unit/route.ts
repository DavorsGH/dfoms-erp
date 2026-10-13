import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { updatePlatformBillingBusinessUnitId } from "@/utils/platform-billing-config";

type UpdateBody = {
  business_unit_id?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const businessUnitId =
    typeof body.business_unit_id === "string" ? body.business_unit_id.trim() : "";
  if (!businessUnitId) {
    return NextResponse.json(
      { error: "business_unit_id is required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const result = await updatePlatformBillingBusinessUnitId(admin, businessUnitId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    business_unit_id: businessUnitId,
    updated_at: new Date().toISOString(),
  });
}
