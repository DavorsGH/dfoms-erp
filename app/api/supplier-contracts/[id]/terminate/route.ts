import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { terminateSupplierContract } from "@/utils/supplier-contracts-api";
import { createClient } from "@/utils/supabase/server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { error } = await terminateSupplierContract(supabase, auth.tenantId, id);

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
