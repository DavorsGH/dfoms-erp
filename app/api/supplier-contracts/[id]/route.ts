import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import {
  SUPPLIER_CONTRACT_HEADER_SELECT,
  SUPPLIER_CONTRACT_SOURCE_TYPE,
} from "@/utils/supplier-contracts-types";
import { createClient } from "@/utils/supabase/server";

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

  return NextResponse.json({
    contract,
    amendments: amendments ?? [],
    deductions: deductions ?? [],
    payables: payables ?? [],
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
  let body: { status?: string };
  try {
    body = (await request.json()) as { status?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const supabase = await getTenantSupabase();
  const { data: existing, error: loadError } = await supabase
    .from("supplier_contracts")
    .select("id, agreement_type, document_url, status")
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Contract not found." }, { status: 404 });
  }

  const nextStatus = body.status?.trim();
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
  }

  const patch: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };
  if (nextStatus) {
    patch.status = nextStatus;
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
