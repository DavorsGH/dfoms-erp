import { NextResponse } from "next/server";
import { requireSessionActor } from "@/lib/attendance-requests/session";

export async function POST(request: Request) {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }

  let body: { request_id?: string };
  try {
    body = (await request.json()) as { request_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const requestId = body.request_id?.trim();
  if (!requestId) {
    return NextResponse.json({ error: "request_id is required" }, { status: 400 });
  }

  const { actor, admin } = session;
  const { data: row, error } = await admin
    .from("attendance_requests")
    .select("id, status, submitted_by")
    .eq("tenant_id", actor.tenantId)
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  if (row.submitted_by !== actor.authUid) {
    return NextResponse.json(
      { error: "You can only cancel a request you submitted." },
      { status: 403 },
    );
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: "Only a pending request can be cancelled." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("attendance_requests")
    .update({
      status: "cancelled",
      decided_by: actor.authUid,
      decided_by_name: actor.fullName,
      decided_at: now,
      updated_at: now,
    })
    .eq("tenant_id", actor.tenantId)
    .eq("id", requestId)
    .eq("status", "pending");

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
