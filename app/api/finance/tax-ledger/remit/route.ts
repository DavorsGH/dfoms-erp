import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { assertRemitBusinessUnitAllowed } from "@/utils/phase5e-lock";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import {
  remitTaxForPeriod,
  type RemitTaxKind,
} from "@/app/dashboard/finance/tax-ledger-remit";
import {
  TAX_SETTINGS_FULL_SELECT,
  emptyTaxSettings,
  normalizeTaxSettings,
  type TaxSettings,
} from "@/app/dashboard/finance/tax-utils";
import { scopeTaxSettingsRead } from "@/utils/phase5e-key-structure";

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

  const readScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: settingsData, error: settingsError } = await scopeTaxSettingsRead(
    supabase
      .from("tax_settings")
      .select(TAX_SETTINGS_FULL_SELECT)
      .eq("tenant_id", tenantId),
    activeBusinessUnitId,
  ).maybeSingle();

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 400 });
  }

  const settings =
    normalizeTaxSettings(settingsData as TaxSettings | null) ??
    emptyTaxSettings(tenantId);

  const result = await remitTaxForPeriod(supabase, {
    tenantId,
    periodMonth,
    kind,
    settings,
    businessUnitId: activeBusinessUnitId,
    readScope,
    viewAllBusinessUnits,
    // Do not trust client-supplied legs — reload scoped from DB.
  });

  if (result.error) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
