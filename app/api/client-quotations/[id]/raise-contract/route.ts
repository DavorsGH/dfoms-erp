import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { raiseContractFromQuotation } from "@/utils/client-quotations-api";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { contract, error } = await raiseContractFromQuotation(
    supabase,
    auth.tenantId,
    id,
  );

  if (error || !contract) {
    return NextResponse.json(
      { error: error ?? "Unable to raise contract from quotation." },
      { status: 400 },
    );
  }

  return NextResponse.json({ service_contract: contract });
}
