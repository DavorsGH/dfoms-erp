import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import type { ClientInvoiceHeaderRow } from "@/utils/client-invoices-types";

type RouteContext = {
  params: Promise<{ paymentId: string }>;
};

type VoidClientInvoicePaymentRpcResult = {
  invoice?: ClientInvoiceHeaderRow;
  voided_receipt_number?: string | null;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { paymentId } = await context.params;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("void_client_invoice_payment", {
    p_tenant_id: auth.tenantId,
    p_payment_id: paymentId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const result = (data ?? {}) as VoidClientInvoicePaymentRpcResult;

  return NextResponse.json({
    client_invoice: result.invoice ?? null,
    voided_receipt_number: result.voided_receipt_number ?? null,
  });
}
