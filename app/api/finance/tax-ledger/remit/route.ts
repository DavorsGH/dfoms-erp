import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { assertRemitBusinessUnitAllowed } from "@/utils/phase5e-lock";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import type { RemitTaxForPeriodResult, RemitTaxKind } from "@/app/dashboard/finance/tax-ledger-remit";

type RemitBody = {
  periodMonth?: string;
  kind?: RemitTaxKind;
};

const REMIT_KINDS: RemitTaxKind[] = ["ssnit", "paye", "vat", "wht"];

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

  let body: RemitBody;
  try {
    body = (await request.json()) as RemitBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const periodMonth = body.periodMonth?.slice(0, 10);
  const kind = body.kind;
  if (!periodMonth || !kind || !REMIT_KINDS.includes(kind)) {
    return NextResponse.json(
      { error: "periodMonth and kind (ssnit|paye|vat|wht) are required" },
      { status: 400 },
    );
  }

  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);

  const remitGate = await assertRemitBusinessUnitAllowed(
    tenantId,
    activeBusinessUnitId,
    viewAllBusinessUnits,
  );
  if (!remitGate.ok) {
    return NextResponse.json({ error: remitGate.error }, { status: 400 });
  }

  resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("remit_tax_for_period", {
    p_tenant_id: tenantId,
    p_business_unit_id: activeBusinessUnitId,
    p_period_month: periodMonth,
    p_kind: kind,
    p_view_all_business_units: viewAllBusinessUnits,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const result = (data ?? {}) as RemitTaxForPeriodResult;

  if (result.error) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
