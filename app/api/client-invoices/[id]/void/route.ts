import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  assertServerRowWriteAccess,
  getServerAuthUid,
} from "@/utils/business-unit-access.server";
import {
  loadClientInvoiceDetail,
  voidClientInvoice,
} from "@/utils/client-invoices-api";
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
    table: "client_invoices",
    rowId: id,
  });
  if (!rowAccess.ok) {
    return NextResponse.json({ error: rowAccess.error }, { status: rowAccess.status });
  }

  const existing = await loadClientInvoiceDetail(supabase, auth.tenantId, id);
  if (existing.error || !existing.invoice) {
    return NextResponse.json(
      { error: existing.error ?? "Invoice not found." },
      { status: 404 },
    );
  }

  const { invoice, error } = await voidClientInvoice(
    supabase,
    auth.tenantId,
    id,
  );

  if (error || !invoice) {
    return NextResponse.json(
      { error: error ?? "Unable to void invoice." },
      { status: 400 },
    );
  }

  return NextResponse.json({ client_invoice: invoice });
}
