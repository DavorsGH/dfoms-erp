import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createPendingLandlordTenant } from "@/utils/landlord-create";
import { notifyStaffLandlordPendingApproval } from "@/utils/real-estate-staff-notifications";
import { createAdminClient } from "@/utils/supabase/admin";

type CreateLandlordBody = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CreateLandlordBody;
  try {
    body = (await request.json()) as CreateLandlordBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const created = await createPendingLandlordTenant(admin, {
    name: body.name ?? "",
    email: body.email ?? "",
    phone: body.phone ?? "",
    address: body.address ?? "",
  });

  if (!created.ok) {
    return NextResponse.json(
      { error: created.error },
      { status: created.status },
    );
  }

  await notifyStaffLandlordPendingApproval({
    landlordTenantId: created.tenantId,
    landlordType: "platform_only",
    landlordName: created.name,
  });

  return NextResponse.json({ success: true, tenant_id: created.tenantId });
}
