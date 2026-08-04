import { NextResponse } from "next/server";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { respondToLesseeComplaintAsTenant } from "@/utils/complaint-management";

type RespondBody = {
  complaint_id?: string;
  response?: string;
};

export async function POST(request: Request) {
  const session = await getPortalLesseeSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RespondBody;
  try {
    body = (await request.json()) as RespondBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const result = await respondToLesseeComplaintAsTenant(admin, {
    tenantId: session.tenantId,
    lesseeId: session.lesseeId,
    complaintId: body.complaint_id ?? "",
    response: body.response ?? "",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, status: result.status });
}
