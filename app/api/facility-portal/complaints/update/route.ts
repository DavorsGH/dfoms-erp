import { NextResponse } from "next/server";
import { requireFacilityManagerSession } from "@/utils/facility-portal-auth";
import { assertFacilityComplaintOnAssignedProperty } from "@/utils/facility-portal-data";
import { updateLesseeComplaint } from "@/utils/complaint-management";

type UpdateBody = {
  complaint_id?: string;
  status?: string;
  staff_response?: string | null;
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

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const complaintId = body.complaint_id?.trim() ?? "";
  if (!complaintId) {
    return NextResponse.json(
      { error: "complaint_id is required" },
      { status: 400 },
    );
  }

  const scope = await assertFacilityComplaintOnAssignedProperty(
    admin,
    session,
    complaintId,
  );
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const staffResponse =
    typeof body.staff_response === "string"
      ? body.staff_response.trim() || null
      : null;

  const result = await updateLesseeComplaint(admin, {
    tenantId: session.tenantId,
    complaintId,
    status: body.status ?? "",
    staffResponse,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, status: result.status });
}
