import { NextResponse } from "next/server";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import { createLesseeComplaint } from "@/utils/complaint-management";

type CreateBody = {
  subject?: string;
  description?: string;
};

export async function POST(request: Request) {
  const session = await getPortalLesseeSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const landlord = await assertDavorsManagedLandlord(admin, session.tenantId);
  if (!landlord.ok) {
    return NextResponse.json(
      {
        error: "Complaints are only available for Davors-managed properties.",
      },
      { status: 400 },
    );
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id")
    .eq("tenant_id", session.tenantId)
    .eq("lessee_id", session.lesseeId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (leaseError) {
    return NextResponse.json({ error: leaseError.message }, { status: 400 });
  }
  if (!lease) {
    return NextResponse.json(
      { error: "No active lease found for your account." },
      { status: 404 },
    );
  }

  const result = await createLesseeComplaint(admin, {
    tenantId: session.tenantId,
    leaseId: lease.lease_id,
    lesseeId: session.lesseeId,
    subject: body.subject ?? "",
    description: body.description ?? "",
    raisedBy: "tenant",
    lesseeName: session.fullName,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, complaint_id: result.complaintId });
}
