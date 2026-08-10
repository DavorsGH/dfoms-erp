import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { isLesseeStatus } from "@/app/dashboard/real-estate/lessees-utils";

type CreateLesseeBody = {
  tenant_id?: string;
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

  let body: CreateLesseeBody;
  try {
    body = (await request.json()) as CreateLesseeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
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
  const status = (body.status?.trim() || "active") as string;

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

  const now = new Date().toISOString();
  const lesseeId = crypto.randomUUID();

  const { error } = await admin.from("lessees").insert({
    tenant_id: landlord.tenantId,
    lessee_id: lesseeId,
    auth_user_id: null,
    full_name: fullName,
    phone,
    email,
    status,
    private_notes: privateNotes,
    created_at: now,
    updated_at: now,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, lessee_id: lesseeId });
}
