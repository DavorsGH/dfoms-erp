import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { convertClientQuotationToInvoice } from "@/utils/client-quotations-api";
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

  const { invoice, error } = await convertClientQuotationToInvoice(
    supabase,
    auth.tenantId,
    id,
  );

  if (error || !invoice) {
    return NextResponse.json(
      { error: error ?? "Unable to convert quotation." },
      { status: 400 },
    );
  }

  void import("@/utils/tenant-admin-director-tier2-notifications").then(
    ({ notifyAdminsDirectorsNewInvoice }) => {
      void notifyAdminsDirectorsNewInvoice(
        auth.tenantId,
        invoice.bill_to_name,
        Number(invoice.total_amount_due) || 0,
      );
    },
  );

  return NextResponse.json({ client_invoice: invoice });
}
