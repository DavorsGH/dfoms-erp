import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  buildPayrollWorkspaceSnapshot,
  sortPayrollSnapshotKeysDeep,
} from "@/app/dashboard/hr-payroll/payroll-workspace-snapshot";
import { parsePeriodKey } from "@/app/dashboard/hr-payroll/payroll-period-utils";
import { ROUTE_HANDLER_AUTH_OPTS } from "@/lib/middleware-trust-policy";
import {
  getActiveBusinessUnitId,
  getCurrentAuthUid,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { canAccessHrPayrollSection } from "@/utils/rbac-access";
import { isPerfProbeEnabled } from "@/utils/perf-probe";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIOD_PARAM_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parsePeriodParam(raw: string | null): string | null {
  if (!raw?.trim()) {
    return null;
  }
  const trimmed = raw.trim();
  if (!PERIOD_PARAM_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export async function GET(request: Request) {
  if (!isPerfProbeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const periodKey = parsePeriodParam(
    new URL(request.url).searchParams.get("period"),
  );
  if (!periodKey) {
    return NextResponse.json(
      { error: "Query param period=YYYY-MM is required." },
      { status: 400 },
    );
  }

  const parsed = parsePeriodKey(periodKey);
  if (!parsed) {
    return NextResponse.json(
      { error: "Query param period=YYYY-MM is invalid." },
      { status: 400 },
    );
  }

  const role = (await getCurrentUserRole(ROUTE_HANDLER_AUTH_OPTS)) as AppRole | null;
  if (!canAccessHrPayrollSection(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [tenantId, authUid, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(ROUTE_HANDLER_AUTH_OPTS),
      getCurrentAuthUid(ROUTE_HANDLER_AUTH_OPTS),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);

  if (!tenantId || !authUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  try {
    const snapshot = await buildPayrollWorkspaceSnapshot({
      supabase,
      tenantId,
      authUid,
      activeBusinessUnitId,
      viewAllBusinessUnits,
      buScope,
      periodKey,
      year: parsed.year,
      month: parsed.month,
    });

    return NextResponse.json(sortPayrollSnapshotKeysDeep(snapshot));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to build snapshot.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
