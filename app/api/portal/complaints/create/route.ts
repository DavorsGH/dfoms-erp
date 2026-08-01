import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";

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

  const subject = body.subject?.trim() ?? "";
  const description = body.description?.trim() ?? "";
  if (!subject) {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }
  if (!description) {
    return NextResponse.json(
      { error: "description is required" },
      { status: 400 },
    );
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

  const nowIso = new Date().toISOString();
  const complaintId = crypto.randomUUID();

  const { error: insertError } = await admin.from("lessee_complaints").insert({
    tenant_id: session.tenantId,
    complaint_id: complaintId,
    lease_id: lease.lease_id,
    lessee_id: session.lesseeId,
    subject,
    description,
    status: "submitted",
    staff_response: null,
    date_reported: nowIso,
    date_resolved: null,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, complaint_id: complaintId });
}
