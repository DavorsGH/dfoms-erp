import { NextResponse } from "next/server";
import {
  approveAttendanceRequest,
  loadApproverContext,
  notifyEmployeeOfDecision,
  REQUEST_COLUMNS,
  type AttendanceRequestRow,
} from "@/lib/attendance-requests/service";
import { requireSessionActor } from "@/lib/attendance-requests/session";
import {
  decideAttendanceRequest,
  isDirectorTierRole,
} from "@/lib/attendance-requests/rules";
import { formatDate } from "@/app/dashboard/finance/income-register-utils";

export async function POST(request: Request) {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }

  let body: { request_id?: string; action?: "approve" | "reject"; decision_note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const requestId = body.request_id?.trim();
  if (!requestId || (body.action !== "approve" && body.action !== "reject")) {
    return NextResponse.json(
      { error: "request_id and action are required." },
      { status: 400 },
    );
  }

  const decisionNote = body.decision_note?.trim() ?? "";
  if (body.action === "reject" && !decisionNote) {
    return NextResponse.json(
      { error: "A decision note is required to reject a request." },
      { status: 400 },
    );
  }
  if (decisionNote.length > 500) {
    return NextResponse.json(
      { error: "Decision note must be 500 characters or fewer." },
      { status: 400 },
    );
  }

  const { actor, admin } = session;
  const approver = await loadApproverContext(admin, actor.tenantId);
  const inbox =
    isDirectorTierRole(actor.role) || approver.approverAuthUid === actor.authUid;
  if (!inbox) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("attendance_requests")
    .select(REQUEST_COLUMNS)
    .eq("tenant_id", actor.tenantId)
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const row = data as AttendanceRequestRow;
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: "This request is no longer pending." },
      { status: 400 },
    );
  }

  const decision = decideAttendanceRequest({
    actorAuthUid: actor.authUid,
    actorRole: actor.role,
    actorStaffId: actor.staffId,
    requestStaffId: row.staff_id,
    approver,
  });
  if (!decision.allowed) {
    const ownRequest =
      actor.staffId != null && actor.staffId === row.staff_id;
    return NextResponse.json(
      {
        error: ownRequest
          ? "You cannot decide your own attendance request."
          : "You are not the approver for this request.",
      },
      { status: 403 },
    );
  }

  if (body.action === "approve") {
    const result = await approveAttendanceRequest({
      admin,
      actor,
      request: row,
      selfApproved: decision.selfApproved,
      decisionNote: decisionNote || null,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code, source: result.source },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("attendance_requests")
    .update({
      status: "rejected",
      decided_by: actor.authUid,
      decided_by_name: actor.fullName,
      decided_at: now,
      decision_note: decisionNote,
      self_approved: decision.selfApproved,
      updated_at: now,
    })
    .eq("tenant_id", actor.tenantId)
    .eq("id", row.id)
    .eq("status", "pending");

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await notifyEmployeeOfDecision({
    admin,
    tenantId: actor.tenantId,
    staffId: row.staff_id,
    title: "Attendance request rejected",
    body: `Your ${row.request_type} attendance for ${formatDate(row.work_date)} was rejected. ${decisionNote}`,
  });

  return NextResponse.json({ ok: true });
}
