import { NextResponse } from "next/server";
import { requireFacilityManagerSession } from "@/utils/facility-portal-auth";
import { assertFacilityLeaseOnAssignedProperty } from "@/utils/facility-portal-data";
import { createLesseeComplaint } from "@/utils/complaint-management";

type CreateBody = {
  lease_id?: string;
  subject?: string;
  description?: string;
};

export async function POST(request: Request) {
  const auth = await requireFacilityManagerSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { session, admin } = auth;
  if (!session.canManageComplaints) {
    return NextResponse.json(
      { error: "You do not have permission to manage complaints." },
      { status: 403 },
    );
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  const subject = body.subject?.trim() ?? "";
  const description = body.description?.trim() ?? "";

  const leaseCheck = await assertFacilityLeaseOnAssignedProperty(
    admin,
    session,
    leaseId,
    { requireActive: true },
  );
  if (!leaseCheck.ok) {
    return NextResponse.json(
      { error: leaseCheck.error },
      { status: leaseCheck.status },
    );
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lessee_id")
    .eq("tenant_id", session.tenantId)
    .eq("lease_id", leaseCheck.leaseId)
    .maybeSingle();

  if (leaseError || !lease) {
    return NextResponse.json(
      { error: leaseError?.message ?? "Lease not found." },
      { status: 400 },
    );
  }

  const { data: lessee } = await admin
    .from("lessees")
    .select("full_name")
    .eq("tenant_id", session.tenantId)
    .eq("lessee_id", lease.lessee_id)
    .maybeSingle();

  const result = await createLesseeComplaint(admin, {
    tenantId: session.tenantId,
    leaseId: leaseCheck.leaseId,
    lesseeId: lease.lessee_id as string,
    subject,
    description,
    raisedBy: "landlord",
    lesseeName: typeof lessee?.full_name === "string" ? lessee.full_name : null,
    landlordName: session.fullName,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    complaint_id: result.complaintId,
  });
}
