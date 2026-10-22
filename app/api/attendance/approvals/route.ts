import { NextResponse } from "next/server";
import {
  attachEmployeeNames,
  listPendingRequests,
  loadApproverContext,
} from "@/lib/attendance-requests/service";
import { requireSessionActor } from "@/lib/attendance-requests/session";
import {
  decideAttendanceRequest,
  isDirectorTierRole,
} from "@/lib/attendance-requests/rules";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchScopedStaffIds } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

export async function GET(request: Request) {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }

  const approver = await loadApproverContext(session.admin, session.actor.tenantId);
  const inbox =
    isDirectorTierRole(session.actor.role) ||
    approver.approverAuthUid === session.actor.authUid;
  if (!inbox) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
    const buScope = resolveBusinessUnitReadScope({
      viewAllBusinessUnits,
      activeBusinessUnitId,
    });
    const { staffIds, error: staffScopeError } = await fetchScopedStaffIds(
      session.admin,
      session.actor.tenantId,
      buScope,
    );
    if (staffScopeError) {
      return NextResponse.json({ error: staffScopeError }, { status: 500 });
    }

    const pending = await listPendingRequests(
      session.admin,
      session.actor.tenantId,
      staffIds,
    );
    const decidable = pending.filter(
      (row) =>
        decideAttendanceRequest({
          actorAuthUid: session.actor.authUid,
          actorRole: session.actor.role,
          actorStaffId: session.actor.staffId,
          requestStaffId: row.staff_id,
          approver,
        }).allowed,
    );
    const countOnly = new URL(request.url).searchParams.get("countOnly") === "1";
    if (countOnly) {
      return NextResponse.json({ count: decidable.length });
    }
    const requests = await attachEmployeeNames(
      session.admin,
      session.actor.tenantId,
      decidable,
    );
    return NextResponse.json({ count: requests.length, requests });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not load approvals.",
      },
      { status: 500 },
    );
  }
}
