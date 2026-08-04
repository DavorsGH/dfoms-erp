import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { createLesseeComplaint } from "@/utils/complaint-management";

type CreateBody = {
  lease_id?: string;
  subject?: string;
  description?: string;
};

/**
 * platform_only: file a complaint about a tenant on a lease.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }

  const { data: lease, error: leaseError } = await auth.admin
    .from("leases")
    .select("lease_id, lessee_id")
    .eq("tenant_id", auth.session.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    return NextResponse.json({ error: leaseError.message }, { status: 400 });
  }
  if (!lease) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }

  const { data: lessee } = await auth.admin
    .from("lessees")
    .select("full_name")
    .eq("tenant_id", auth.session.tenantId)
    .eq("lessee_id", lease.lessee_id)
    .maybeSingle();

  const result = await createLesseeComplaint(auth.admin, {
    tenantId: auth.session.tenantId,
    leaseId,
    lesseeId: lease.lessee_id,
    subject: body.subject ?? "",
    description: body.description ?? "",
    raisedBy: "landlord",
    lesseeName:
      typeof lessee?.full_name === "string" ? lessee.full_name : null,
    landlordName: auth.session.fullName,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, complaint_id: result.complaintId });
}
