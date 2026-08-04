import { NextResponse } from "next/server";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { acknowledgeLesseeComplaint } from "@/utils/complaint-management";

type AcknowledgeBody = {
  complaint_id?: string;
};

export async function POST(request: Request) {
  const session = await getPortalLesseeSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: AcknowledgeBody;
  try {
    body = (await request.json()) as AcknowledgeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const result = await acknowledgeLesseeComplaint(admin, {
    tenantId: session.tenantId,
    lesseeId: session.lesseeId,
    complaintId: body.complaint_id ?? "",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    acknowledged_at: result.acknowledgedAt,
  });
}
