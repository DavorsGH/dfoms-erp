import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { getServerAuthUid } from "@/utils/business-unit-access.server";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { addSupplierContractAmendment } from "@/utils/supplier-contracts-api";
import type { SupplierContractAmendmentWriteBody } from "@/utils/supplier-contracts-types";
import { createClient } from "@/utils/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  let body: SupplierContractAmendmentWriteBody;
  try {
    body = (await request.json()) as SupplierContractAmendmentWriteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.effective_date || !body.change_reason?.trim()) {
    return NextResponse.json({ error: "Effective date and reason are required." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const authUser = await getServerAuthUid(supabase);
  if (!authUser.ok) {
    return NextResponse.json({ error: authUser.error }, { status: authUser.status });
  }
  const { amendmentId, error } = await addSupplierContractAmendment(
    supabase,
    auth.tenantId,
    id,
    body,
    authUser.authUid,
  );

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, amendment_id: amendmentId });
}
