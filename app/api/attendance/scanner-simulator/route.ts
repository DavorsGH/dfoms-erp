import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { scannerSimulatorAllowed } from "@/lib/adms/scanner-simulator-gate";
import {
  cleanupSimulatorData,
  listSimulatorEmployees,
  runAllScannerScenarios,
  runScannerScenario,
} from "@/lib/adms/scanner-simulator-run";
import {
  SIMULATOR_SCENARIOS,
  type SimulatorScenarioId,
} from "@/lib/adms/scanner-simulator-traffic";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchScopedStaffIds } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

export const maxDuration = 120;

function unavailable() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function isScenario(value: string): value is SimulatorScenarioId {
  return (SIMULATOR_SCENARIOS as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  if (!scannerSimulatorAllowed()) {
    return unavailable();
  }
  const auth = await requireTenantRoleIn(["super_admin"]);
  if (!auth.ok) {
    return auth.response;
  }
  const deviceId = new URL(request.url).searchParams.get("deviceId")?.trim() ?? "";
  if (!deviceId) {
    return NextResponse.json({ error: "Choose a device." }, { status: 400 });
  }
  try {
    const admin = createAdminClient();
    const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
    const buScope = resolveBusinessUnitReadScope({
      viewAllBusinessUnits,
      activeBusinessUnitId,
    });
    const { staffIds, error: staffScopeError } = await fetchScopedStaffIds(
      admin,
      auth.tenantId,
      buScope,
    );
    if (staffScopeError) {
      return NextResponse.json({ error: staffScopeError }, { status: 500 });
    }
    const employees = await listSimulatorEmployees(
      admin,
      auth.tenantId,
      deviceId,
      staffIds,
    );
    return NextResponse.json({ employees });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load employees." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!scannerSimulatorAllowed()) {
    return unavailable();
  }
  const auth = await requireTenantRoleIn(["super_admin"]);
  if (!auth.ok) {
    return auth.response;
  }
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    deviceId?: string;
    scenario?: string;
    weekStart?: string;
    pin?: string;
    localDateTime?: string;
    direction?: "in" | "out";
    replayBody?: string;
  } | null;
  const deviceId = body?.deviceId?.trim() ?? "";
  if (!deviceId) {
    return NextResponse.json({ error: "Choose a device." }, { status: 400 });
  }
  const admin = createAdminClient();
  const origin = new URL(request.url).origin;
  try {
    if (body?.action === "cleanup") {
      const result = await cleanupSimulatorData(admin, auth.tenantId, deviceId);
      return NextResponse.json(result);
    }
    if (body?.action === "run_all") {
      const weekStart = body.weekStart?.trim() ?? "";
      if (!weekStart) {
        return NextResponse.json(
          { error: "Choose a week that has already ended." },
          { status: 400 },
        );
      }
      const cards = await runAllScannerScenarios({
        admin,
        origin,
        tenantId: auth.tenantId,
        deviceId,
        weekStart,
      });
      return NextResponse.json({ cards });
    }
    if (body?.action === "run") {
      const scenario = body.scenario?.trim() ?? "";
      if (!isScenario(scenario)) {
        return NextResponse.json({ error: "Choose a scenario." }, { status: 400 });
      }
      const card = await runScannerScenario({
        admin,
        origin,
        tenantId: auth.tenantId,
        deviceId,
        scenario,
        weekStart: body.weekStart,
        pin: body.pin,
        localDateTime: body.localDateTime,
        direction: body.direction,
        replayBody: body.replayBody,
      });
      return NextResponse.json({ card });
    }
    return NextResponse.json({ error: "Choose a simulator action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Scanner simulator failed.",
      },
      { status: 500 },
    );
  }
}
