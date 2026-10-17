import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { getViewAllBusinessUnits } from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  assertRemitBusinessUnitAllowed,
  resolvePayrollWriteBusinessUnitId,
} from "@/utils/phase5e-lock";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import type { RemitTaxForPeriodResult, RemitTaxKind } from "@/app/dashboard/finance/tax-ledger-remit";

type RemitBody = {
  periodMonth?: string;
  kind?: RemitTaxKind;
  tax_ledger_entry_id?: string;
  remittance_date?: string;
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

  const [writeBu, viewAllBusinessUnits] = await Promise.all([
    resolvePayrollWriteBusinessUnitId(tenantId),
    getViewAllBusinessUnits(),
  ]);
  if (!writeBu.ok) {
    return NextResponse.json({ error: writeBu.error }, { status: 400 });
  }
  const activeBusinessUnitId = writeBu.businessUnitId;

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
  const { remitTaxForPeriod } = await import(
    "@/app/dashboard/finance/tax-ledger-remit"
  );
  const { TAX_SETTINGS_FULL_SELECT } = await import(
    "@/app/dashboard/finance/tax-utils"
  );
  const { scopeTaxSettingsRead } = await import(
    "@/utils/phase5e-key-structure"
  );
  type TaxDueDateSettingsSlice = import("@/app/dashboard/finance/tax-ledger-utils").TaxDueDateSettingsSlice;

  if (!activeBusinessUnitId) {
    return NextResponse.json({ error: "Business unit is required." }, { status: 400 });
  }

  const { data: taxSettingsRow } = await scopeTaxSettingsRead(
    admin
      .from("tax_settings")
      .select(TAX_SETTINGS_FULL_SELECT)
      .eq("tenant_id", tenantId),
    activeBusinessUnitId,
  ).maybeSingle();
  const settings = (taxSettingsRow ??
    {}) as unknown as TaxDueDateSettingsSlice;
  const entryId = body.tax_ledger_entry_id?.trim();
  const remittanceDate = body.remittance_date?.slice(0, 10);

  const result = await remitTaxForPeriod(admin, {
    tenantId,
    periodMonth,
    kind,
    settings,
    businessUnitId: activeBusinessUnitId,
    readScope: { mode: "unit", id: activeBusinessUnitId },
    viewAllBusinessUnits,
    taxLedgerEntryIds: entryId ? [entryId] : undefined,
    remittanceDate,
  });

  if (result.error) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
