import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { loadDraftOrActiveServiceContractsForCustomer } from "@/utils/service-contracts-api";
import {
  CRM_QUOTATIONS_EDIT_ROLES,
  FINANCE_SECTION_ROLES,
} from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

const FOR_CUSTOMER_ROLES = [...FINANCE_SECTION_ROLES, ...CRM_QUOTATIONS_EDIT_ROLES] as const;

export async function GET(request: Request) {
  const auth = await requireTenantRoleIn(FOR_CUSTOMER_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const clientId = new URL(request.url).searchParams.get("client_id")?.trim() ?? "";
  if (!clientId) {
    return NextResponse.json({ error: "client_id is required." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { contracts, error } = await loadDraftOrActiveServiceContractsForCustomer(
    supabase,
    auth.tenantId,
    clientId,
  );

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({ contracts });
}
