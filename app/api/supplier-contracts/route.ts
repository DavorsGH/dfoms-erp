import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { getServerAuthUid, resolveServerWriteBusinessUnitId } from "@/utils/business-unit-access.server";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createSupplierContract } from "@/utils/supplier-contracts-api";
import {
  SUPPLIER_CONTRACT_LIST_SELECT,
  normalizeSupplierContractListRow,
  validateSupplierContractBody,
  type SupplierContractListDbRow,
  type SupplierContractWriteBody,
} from "@/utils/supplier-contracts-types";
import { createClient } from "@/utils/supabase/server";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export async function GET() {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("supplier_contracts")
      .select(SUPPLIER_CONTRACT_LIST_SELECT)
      .eq("tenant_id", auth.tenantId),
    buScope,
  )
    .order("start_date", { ascending: false })
    .order("contract_sequence", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    contracts: ((data as SupplierContractListDbRow[] | null) ?? []).map(
      normalizeSupplierContractListRow,
    ),
  });
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: SupplierContractWriteBody;
  try {
    body = (await request.json()) as SupplierContractWriteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const validationError = validateSupplierContractBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const supabase = await getTenantSupabase();
  const authUser = await getServerAuthUid(supabase);
  if (!authUser.ok) {
    return NextResponse.json({ error: authUser.error }, { status: authUser.status });
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

  const { contract, error } = await createSupplierContract(
    supabase,
    auth.tenantId,
    body,
    authUser.authUid,
    stamp.businessUnitId,
  );

  if (error || !contract) {
    return NextResponse.json({ error: error ?? "Unable to create contract." }, { status: 400 });
  }

  return NextResponse.json({ contract });
}
