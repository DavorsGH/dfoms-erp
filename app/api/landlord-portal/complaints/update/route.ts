import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { updateLesseeComplaint } from "@/utils/complaint-management";

type UpdateBody = {
  complaint_id?: string;
  status?: string;
  staff_response?: string | null;
};

/**
 * Platform-only landlord respond / resolve for own tenant_id complaints.
 * Mutations use service role after session + landlord_type checks (RLS is SELECT-only).
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const staffResponse =
    typeof body.staff_response === "string"
      ? body.staff_response.trim() || null
      : null;

  const result = await updateLesseeComplaint(auth.admin, {
    tenantId: auth.session.tenantId,
    complaintId: body.complaint_id ?? "",
    status: body.status ?? "",
    staffResponse,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, status: result.status });
}
