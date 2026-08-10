import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { isLesseeStatus } from "@/app/dashboard/real-estate/lessees-utils";

type UpdateLesseeBody = {
  tenant_id?: string;
  lessee_id?: string;
  full_name?: string;
  phone?: string;
  email?: string | null;
  status?: string;
  private_notes?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateLesseeBody;
  try {
    body = (await request.json()) as UpdateLesseeBody;
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

  const fullName = body.full_name?.trim() ?? "";
  const phone = body.phone?.trim() ?? "";
  const email = body.email?.trim() || null;
  const privateNotes = body.private_notes?.trim() || null;
  const status = body.status?.trim() ?? "";

  if (!fullName) {
    return NextResponse.json({ error: "full_name is required" }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }
  if (!isLesseeStatus(status)) {
    return NextResponse.json(
      { error: "status must be active or former." },
      { status: 400 },
    );
  }

  const { data, error } = await admin
    .from("lessees")
    .update({
      full_name: fullName,
      phone,
      email,
      status,
      private_notes: privateNotes,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("lessee_id", lesseeId)
    .select("lessee_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
