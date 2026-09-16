import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  assertServerRowWriteAccess,
  getServerAuthUid,
} from "@/utils/business-unit-access.server";
import { loadServiceContractDetail } from "@/utils/service-contracts-api";
import { notifyServiceContractDocumentResend } from "@/utils/service-contract-document-notify";
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

  const authUser = await getServerAuthUid(supabase);
  if (!authUser.ok) {
    return NextResponse.json({ error: authUser.error }, { status: authUser.status });
  }

  const rowAccess = await assertServerRowWriteAccess({
    supabase,
    tenantId: auth.tenantId,
    authUid: authUser.authUid,
    table: "service_contracts",
    rowId: id,
  });
  if (!rowAccess.ok) {
    return NextResponse.json({ error: rowAccess.error }, { status: rowAccess.status });
  }

  const detail = await loadServiceContractDetail(supabase, auth.tenantId, id);
  if (detail.error || !detail.contract) {
    return NextResponse.json(
      { error: detail.error ?? "Service contract not found." },
      { status: 404 },
    );
  }

  if (!detail.contract.document_url?.trim()) {
    return NextResponse.json(
      { error: "Attach a contract document before resending." },
      { status: 400 },
    );
  }

  notifyServiceContractDocumentResend({
    supabase,
    tenantId: auth.tenantId,
    contract: detail.contract,
  });

  return NextResponse.json({ success: true });
}
