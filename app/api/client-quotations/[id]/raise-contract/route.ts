import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  loadClientQuotationDetail,
  raiseContractFromQuotation,
} from "@/utils/client-quotations-api";
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

  const existing = await loadClientQuotationDetail(supabase, auth.tenantId, id);
  if (existing.error || !existing.quotation) {
    return NextResponse.json(
      { error: existing.error ?? "Quotation not found." },
      { status: 404 },
    );
  }

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

  const quotation = existing.quotation;
  void Promise.all([
    import("@/utils/client-document-notifications"),
    import("@/utils/tenant-admin-director-tier2-notifications"),
  ]).then(
    ([
      { notifyClientContractRaised },
      { notifyAdminsDirectorsContractRaised },
    ]) => {
      void notifyClientContractRaised({
        tenantId: auth.tenantId,
        clientId: quotation.client_id,
        contractId: contract.id,
        contractNumber: contract.contract_number,
        quotationNumber: quotation.quotation_number,
        customerName: quotation.bill_to_name?.trim() || quotation.client_id,
      });

      void notifyAdminsDirectorsContractRaised(
        auth.tenantId,
        contract.contract_number,
        quotation.quotation_number,
        quotation.bill_to_name,
      );
    },
  );

  return NextResponse.json({ service_contract: contract });
}
