import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  assertServerRowWriteAccess,
  getServerAuthUid,
} from "@/utils/business-unit-access.server";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
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
    table: "client_invoice_payments",
    rowId: paymentId,
  });
  if (!rowAccess.ok) {
    return NextResponse.json({ error: rowAccess.error }, { status: rowAccess.status });
  }

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
