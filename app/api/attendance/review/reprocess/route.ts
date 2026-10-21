import { NextResponse } from "next/server";
import { processBiometricPunchesForTenant } from "@/lib/adms/punch-processor";
import { unprocessedPunchCutoff } from "@/lib/adms/punch-eligibility";
import {
  canSetAttendanceClockOut,
  requireSessionActor,
} from "@/lib/attendance-requests/session";

export async function POST() {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }
  if (!canSetAttendanceClockOut(session.actor.role)) {
    return NextResponse.json(
      {
        error:
          "Only HR, a director, or a super admin can reprocess attendance punches.",
      },
      { status: 403 },
    );
  }

  try {
    await processBiometricPunchesForTenant(session.admin, session.actor.tenantId, {
      olderThanIso: unprocessedPunchCutoff(),
      retryProcessingErrors: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not reprocess attendance punches.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
