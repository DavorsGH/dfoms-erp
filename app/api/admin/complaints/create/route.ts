import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import { createLesseeComplaint } from "@/utils/complaint-management";

type CreateBody = {
  tenant_id?: string;
  lease_id?: string;
  subject?: string;
  description?: string;
};

/**
 * Staff files a landlord-raised complaint on behalf of a davors_managed landlord.
 */
export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const landlord = await assertDavorsManagedLandlord(admin, body.tenant_id ?? "");
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const leaseId = body.lease_id?.trim() ?? "";
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id, lessee_id")
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    return NextResponse.json({ error: leaseError.message }, { status: 400 });
  }
  if (!lease) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }

  const [{ data: lessee }, { data: tenant }] = await Promise.all([
    admin
      .from("lessees")
      .select("full_name")
      .eq("tenant_id", landlord.tenantId)
      .eq("lessee_id", lease.lessee_id)
      .maybeSingle(),
    admin
      .from("tenants")
      .select("name")
      .eq("id", landlord.tenantId)
      .maybeSingle(),
  ]);

  const result = await createLesseeComplaint(admin, {
    tenantId: landlord.tenantId,
    leaseId,
    lesseeId: lease.lessee_id,
    subject: body.subject ?? "",
    description: body.description ?? "",
    raisedBy: "landlord",
    lesseeName:
      typeof lessee?.full_name === "string" ? lessee.full_name : null,
    landlordName: typeof tenant?.name === "string" ? tenant.name : null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, complaint_id: result.complaintId });
}
