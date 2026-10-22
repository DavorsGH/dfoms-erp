import { NextResponse } from "next/server";
import {
  canWriteAttendanceDevices,
  requireSessionActor,
} from "@/lib/attendance-requests/session";

export async function POST(request: Request) {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }
  if (!canWriteAttendanceDevices(session.actor.role)) {
    return NextResponse.json(
      { error: "You do not have permission to dismiss attendance review notes." },
      { status: 403 },
    );
  }

  let body: { punch_id?: string };
  try {
    body = (await request.json()) as { punch_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const punchId = body.punch_id?.trim();
  if (!punchId) {
    return NextResponse.json({ error: "punch_id is required" }, { status: 400 });
  }

  const { admin, actor } = session;
  const { data: punch, error } = await admin
    .from("biometric_punches")
    .select("id, process_note, staff_id")
    .eq("tenant_id", actor.tenantId)
    .eq("id", punchId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!punch) {
    return NextResponse.json({ error: "Punch not found." }, { status: 404 });
  }

  const current = String(punch.process_note ?? (punch.staff_id ? "" : "unmapped"));
  const nextNote = current.endsWith(":dismissed")
    ? current
    : `${current || "unmapped"}:dismissed`;

  const { error: updateError } = await admin
    .from("biometric_punches")
    .update({
      processed_at: new Date().toISOString(),
      process_note: nextNote,
    })
    .eq("tenant_id", actor.tenantId)
    .eq("id", punchId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
