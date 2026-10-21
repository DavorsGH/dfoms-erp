import { NextResponse } from "next/server";
import {
  applyRemoteClockOutToRegister,
  insertPendingRequest,
  listOwnRequests,
  loadApproverContext,
  notifyAttendanceApprovers,
  REQUEST_COLUMNS,
  submitAutoApprovedRemoteRequest,
  type AttendanceRequestRow,
} from "@/lib/attendance-requests/service";
import { requireSessionActor } from "@/lib/attendance-requests/session";
import {
  parseOptionalGeo,
  remoteClockOutPlan,
  todayInAccra,
  validateClockPair,
  validatePastWorkDate,
} from "@/lib/attendance-requests/rules";
import {
  decideRemoteClock,
  EXEMPT_ATTENDANCE_MESSAGE,
  findCoveringArrangement,
  hasOpenArrangement,
  REMOTE_NOT_ENABLED_MESSAGE,
  type RemoteWorkArrangement,
} from "@/lib/attendance-mode";
import { loadArrangementsForStaff } from "@/lib/attendance-mode-service";

const loadArrangements = loadArrangementsForStaff;

export async function GET(request: Request) {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }

  const { actor, admin } = session;
  const summaryOnly = new URL(request.url).searchParams.get("summary") === "1";
  const mode = actor.attendanceMode;

  if (mode === "exempt") {
    return NextResponse.json({
      allowed: false,
      mode,
      message: EXEMPT_ATTENDANCE_MESSAGE,
      requests: [],
    });
  }

  if (!actor.staffId) {
    return NextResponse.json({ allowed: false, mode, requests: [] });
  }

  try {
    const today = todayInAccra();
    const arrangements = await loadArrangements(
      admin,
      actor.tenantId,
      actor.staffId,
    );
    const allowed =
      mode === "quick_remote" ||
      actor.remoteAttendanceAllowed ||
      hasOpenArrangement(arrangements, {
        tenantId: actor.tenantId,
        staffId: actor.staffId,
        todayIso: today,
      });
    const decision = decideRemoteClock({
      mode,
      remoteAttendanceAllowed: actor.remoteAttendanceAllowed,
      arrangement: findCoveringArrangement(arrangements, {
        tenantId: actor.tenantId,
        staffId: actor.staffId,
        dateIso: today,
      }),
    });
    const autoApprove = decision.allowed && decision.autoApprove;
    const approvalNote = decision.allowed ? decision.note : null;

    if (summaryOnly) {
      return NextResponse.json({ allowed, mode, requests: [] });
    }
    const requests = await listOwnRequests(admin, actor.tenantId, actor.staffId);
    return NextResponse.json({
      allowed,
      mode,
      auto_approve: autoApprove,
      approval_note: approvalNote,
      requests,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load requests." },
      { status: 500 },
    );
  }
}

type RemoteBody = {
  action?: "clock_in" | "clock_out" | "past_day";
  location_note?: string;
  reason?: string;
  work_date?: string;
  clock_in?: string;
  clock_out?: string;
  latitude?: number;
  longitude?: number;
  location_accuracy_m?: number;
};

export async function POST(request: Request) {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }

  const { actor, admin } = session;
  if (!actor.staffId) {
    return NextResponse.json(
      { error: "Your user account is not linked to an employee record." },
      { status: 400 },
    );
  }

  if (actor.attendanceMode === "exempt") {
    return NextResponse.json(
      { error: EXEMPT_ATTENDANCE_MESSAGE },
      { status: 403 },
    );
  }

  let body: RemoteBody;
  try {
    body = (await request.json()) as RemoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let arrangements: RemoteWorkArrangement[];
  try {
    arrangements = await loadArrangements(admin, actor.tenantId, actor.staffId);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load remote work arrangements.",
      },
      { status: 500 },
    );
  }

  function decisionFor(dateIso: string) {
    return decideRemoteClock({
      mode: actor.attendanceMode,
      remoteAttendanceAllowed: actor.remoteAttendanceAllowed,
      arrangement: findCoveringArrangement(arrangements, {
        tenantId: actor.tenantId,
        staffId: actor.staffId as string,
        dateIso,
      }),
    });
  }

  if (body.action === "clock_out") {
    const today = todayInAccra();
    const { data: openRequest, error } = await admin
      .from("attendance_requests")
      .select(REQUEST_COLUMNS)
      .eq("tenant_id", actor.tenantId)
      .eq("staff_id", actor.staffId)
      .eq("work_date", today)
      .eq("request_type", "remote")
      .in("status", ["pending", "approved"])
      .is("clock_out", null)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!openRequest) {
      return NextResponse.json(
        { error: "No open remote attendance request for today." },
        { status: 404 },
      );
    }

    const open = openRequest as AttendanceRequestRow;
    const now = new Date().toISOString();
    const locationNote =
      body.location_note?.trim() || open.location_note?.trim() || null;
    const clockOutDecision = decisionFor(today);
    const plan = remoteClockOutPlan({
      status: open.status === "approved" ? "approved" : "pending",
      remoteAttendanceAllowed: actor.remoteAttendanceAllowed,
      autoApprove: clockOutDecision.allowed && clockOutDecision.autoApprove,
    });
    const { error: updateError } = await admin
      .from("attendance_requests")
      .update({
        clock_out: now,
        location_note: locationNote,
        updated_at: now,
        ...(plan === "reopen_pending" ? { status: "pending" } : {}),
      })
      .eq("tenant_id", actor.tenantId)
      .eq("id", open.id)
      .in("status", ["pending", "approved"]);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (plan === "auto_apply") {
      const applied = await applyRemoteClockOutToRegister({
        admin,
        tenantId: actor.tenantId,
        request: { ...open, clock_out: now, location_note: locationNote },
      });
      if (!applied.ok) {
        return NextResponse.json({ error: applied.error }, { status: 500 });
      }
      return NextResponse.json({ ok: true, applied: true });
    }

    if (plan === "reopen_pending") {
      const approver = await loadApproverContext(admin, actor.tenantId);
      await notifyAttendanceApprovers({
        admin,
        tenantId: actor.tenantId,
        approver,
        staffIds: [actor.staffId],
        title: "Remote attendance to approve",
        body: `${actor.fullName} submitted a clock-out for ${today}.`,
      });
    }

    return NextResponse.json({ ok: true, applied: false });
  }

  const locationNote = body.location_note?.trim() ?? "";
  const reason = body.reason?.trim() ?? "";
  if (!locationNote) {
    return NextResponse.json(
      { error: "Location note is required." },
      { status: 400 },
    );
  }
  if (locationNote.length > 500 || reason.length > 500) {
    return NextResponse.json(
      { error: "Location note and reason must be 500 characters or fewer." },
      { status: 400 },
    );
  }

  const geo = parseOptionalGeo(body);
  if (geo && "error" in geo) {
    return NextResponse.json({ error: geo.error }, { status: 400 });
  }

  const now = new Date();
  let workDate = todayInAccra(now);
  let clockInIso = now.toISOString();
  let clockOutIso: string | null = null;

  if (body.action === "past_day") {
    workDate = body.work_date?.trim() ?? "";
    const dateError = validatePastWorkDate(workDate, now);
    if (dateError) {
      return NextResponse.json({ error: dateError }, { status: 400 });
    }
    if (!body.clock_in?.trim() || !body.clock_out?.trim()) {
      return NextResponse.json(
        { error: "Clock-in and clock-out are both required." },
        { status: 400 },
      );
    }
    const pair = validateClockPair({
      workDate,
      clockIn: body.clock_in,
      clockOut: body.clock_out,
      now,
    });
    if ("error" in pair) {
      return NextResponse.json({ error: pair.error }, { status: 400 });
    }
    clockInIso = pair.clockInIso;
    clockOutIso = pair.clockOutIso;
  } else if (body.action !== "clock_in") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  // Standard staff need the remote flag or an arrangement covering this day.
  const decision = decisionFor(workDate);
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error:
          decision.code === "exempt"
            ? EXEMPT_ATTENDANCE_MESSAGE
            : REMOTE_NOT_ENABLED_MESSAGE,
      },
      { status: 403 },
    );
  }

  const requestRow = {
    tenant_id: actor.tenantId,
    request_type: "remote" as const,
    staff_id: actor.staffId,
    work_date: workDate,
    clock_in: clockInIso,
    clock_out: clockOutIso,
    location_note: locationNote,
    reason: reason || null,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    location_accuracy_m: geo?.location_accuracy_m ?? null,
    device_id: null,
    site_code: actor.assignedSiteId,
    submitted_by: actor.authUid,
    submitted_by_name: actor.fullName,
  };

  if (decision.autoApprove && decision.note) {
    const autoResult = await submitAutoApprovedRemoteRequest({
      admin,
      actor,
      row: requestRow,
      approvalNote: decision.note,
    });
    if (!autoResult.ok) {
      return NextResponse.json(
        { error: autoResult.error },
        { status: autoResult.status },
      );
    }
    return NextResponse.json({
      ok: true,
      id: autoResult.id,
      auto_approved: true,
      message: decision.note,
    });
  }

  const inserted = await insertPendingRequest(admin, requestRow);

  if ("error" in inserted) {
    return NextResponse.json(
      { error: inserted.error },
      { status: inserted.duplicate ? 409 : 500 },
    );
  }

  const approver = await loadApproverContext(admin, actor.tenantId);
  await notifyAttendanceApprovers({
    admin,
    tenantId: actor.tenantId,
    approver,
    staffIds: [actor.staffId],
    title: "Remote attendance to approve",
    body: `${actor.fullName} submitted remote attendance for ${workDate}.`,
  });

  return NextResponse.json({ ok: true, id: inserted.id });
}
