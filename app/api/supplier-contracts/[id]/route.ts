import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  assertServerRowWriteAccess,
  getServerAuthUid,
  resolveServerWriteBusinessUnitId,
} from "@/utils/business-unit-access.server";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import {
  SUPPLIER_CONTRACT_HEADER_SELECT,
  SUPPLIER_CONTRACT_SOURCE_TYPE,
  normalizeSupplierContractStatus,
  type SupplierContractSettingsPatch,
} from "@/utils/supplier-contracts-types";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { createTenantLogosSignedUrl } from "@/utils/tenant-logos-storage";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const supabase = await getTenantSupabase();

  const [
    { data: contract, error: contractError },
    { data: amendments },
    { data: deductions },
    { data: payables },
  ] = await Promise.all([
    supabase
      .from("supplier_contracts")
      .select(SUPPLIER_CONTRACT_HEADER_SELECT)
      .eq("tenant_id", auth.tenantId)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("supplier_contract_amendments")
      .select("*")
      .eq("tenant_id", auth.tenantId)
      .eq("contract_id", id)
      .order("effective_date", { ascending: false }),
    supabase
      .from("supplier_contract_deductions")
      .select("*")
      .eq("tenant_id", auth.tenantId)
      .eq("contract_id", id)
      .order("service_date", { ascending: false }),
    supabase
      .from("accounts_payable")
      .select("*")
      .eq("tenant_id", auth.tenantId)
      .eq("source_type", SUPPLIER_CONTRACT_SOURCE_TYPE)
      .eq("source_id", id)
      .order("invoice_date", { ascending: false }),
  ]);

  if (contractError) {
    return NextResponse.json({ error: contractError.message }, { status: 500 });
  }
  if (!contract) {
    return NextResponse.json({ error: "Contract not found." }, { status: 404 });
  }

  let business_unit_name: string | null = null;
  const businessUnitId = (contract as { business_unit_id?: string | null })
    .business_unit_id;
  if (businessUnitId) {
    const { data: buRow } = await supabase
      .from("business_units")
      .select("name")
      .eq("tenant_id", auth.tenantId)
      .eq("id", businessUnitId)
      .maybeSingle();
    business_unit_name = (buRow as { name?: string } | null)?.name ?? null;
  }

  let document_signed_url: string | null = null;
  const documentPath = String(
    (contract as { document_url?: string | null }).document_url ?? "",
  ).trim();
  if (documentPath) {
    const admin = createAdminClient();
    document_signed_url =
      (await createTenantLogosSignedUrl(admin, documentPath)) ?? documentPath;
  }

  return NextResponse.json({
    contract,
    amendments: amendments ?? [],
    deductions: deductions ?? [],
    payables: payables ?? [],
    business_unit_name,
    document_signed_url,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  let body: SupplierContractSettingsPatch;
  try {
    body = (await request.json()) as SupplierContractSettingsPatch;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const supabase = await getTenantSupabase();
  const authUser = await getServerAuthUid(supabase);
  if (!authUser.ok) {
    return NextResponse.json({ error: authUser.error }, { status: authUser.status });
  }

  const rowAccess = await assertServerRowWriteAccess({
    supabase,
    tenantId: auth.tenantId,
    authUid: authUser.authUid,
    table: "supplier_contracts",
    rowId: id,
  });
  if (!rowAccess.ok) {
    return NextResponse.json({ error: rowAccess.error }, { status: rowAccess.status });
  }

  const { data: existing, error: loadError } = await supabase
    .from("supplier_contracts")
    .select(
      "id, agreement_type, document_url, status, start_date, end_date, auto_renew, mid_month_reminder_enabled, mid_month_reminder_day, notes, business_unit_id",
    )
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Contract not found." }, { status: 404 });
  }

  const currentStatus = normalizeSupplierContractStatus(existing.status);
  if (currentStatus === "terminated") {
    return NextResponse.json(
      { error: "Terminated contracts cannot be edited." },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  const nextStatus =
    body.status !== undefined
      ? normalizeSupplierContractStatus(body.status)
      : currentStatus;

  if (nextStatus === "active") {
    if (
      existing.agreement_type === "written" &&
      !(existing.document_url ?? "").trim()
    ) {
      return NextResponse.json(
        { error: "Written agreements require a document before activation." },
        { status: 400 },
      );
    }
    patch.status = "active";
  } else if (body.status !== undefined) {
    patch.status = nextStatus;
  }

  if (body.end_date !== undefined) {
    const endDate = body.end_date.trim();
    if (!endDate) {
      return NextResponse.json({ error: "End date is required." }, { status: 400 });
    }
    if (endDate < String(existing.start_date).slice(0, 10)) {
      return NextResponse.json(
        { error: "End date must be on or after start date." },
        { status: 400 },
      );
    }
    patch.end_date = endDate;
  }

  if (body.auto_renew !== undefined) {
    patch.auto_renew = body.auto_renew;
  }

  if (body.mid_month_reminder_enabled !== undefined) {
    patch.mid_month_reminder_enabled = body.mid_month_reminder_enabled;
  }

  if (body.mid_month_reminder_day !== undefined) {
    const day = Number(body.mid_month_reminder_day);
    if (!Number.isFinite(day) || day < 1 || day > 28) {
      return NextResponse.json(
        { error: "Mid-month reminder day must be between 1 and 28." },
        { status: 400 },
      );
    }
    patch.mid_month_reminder_day = day;
  }

  if (body.notes !== undefined) {
    patch.notes = body.notes?.trim() || null;
  }

  if (body.business_unit_id !== undefined) {
    const { count: payableCount, error: payableError } = await supabase
      .from("accounts_payable")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", auth.tenantId)
      .eq("source_type", SUPPLIER_CONTRACT_SOURCE_TYPE)
      .eq("source_id", id);

    if (payableError) {
      return NextResponse.json({ error: payableError.message }, { status: 400 });
    }
    if ((payableCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "Business unit cannot be changed after monthly bills have been generated.",
        },
        { status: 400 },
      );
    }

    const stamp = await resolveServerWriteBusinessUnitId({
      supabase,
      tenantId: auth.tenantId,
      authUid: authUser.authUid,
      requestedBusinessUnitId: body.business_unit_id,
    });
    if (!stamp.ok) {
      return NextResponse.json({ error: stamp.error }, { status: stamp.status });
    }
    if (stamp.allowedUnits !== null && !stamp.businessUnitId) {
      return NextResponse.json(
        { error: "Business unit is required for this workspace." },
        { status: 400 },
      );
    }
    patch.business_unit_id = stamp.businessUnitId;
  }

  const { error: updateError } = await supabase
    .from("supplier_contracts")
    .update(patch)
    .eq("tenant_id", auth.tenantId)
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
