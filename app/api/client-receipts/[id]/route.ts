import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireRoleIn, requireTenantRoleIn } from "@/utils/admin-auth";
import { loadClientReceiptDetail } from "@/utils/client-invoice-payments-api";
import {
  CLIENT_PORTAL_SECTION_ROLES,
  FINANCE_SECTION_ROLES,
} from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { loadBusinessUnitDocumentContact } from "@/utils/business-unit-document-contact";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

async function authorizeReceiptAccess() {
  const financeAuth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (financeAuth.ok) {
    return { ok: true as const, tenantId: financeAuth.tenantId };
  }

  const clientAuth = await requireRoleIn(CLIENT_PORTAL_SECTION_ROLES);
  if (!clientAuth.ok) {
    return { ok: false as const, response: clientAuth.response };
  }

  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, tenantId };
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await authorizeReceiptAccess();
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const supabase = await getTenantSupabase();
  const detail = await loadClientReceiptDetail(supabase, auth.tenantId, id);

  if (detail.error || !detail.receipt) {
    return NextResponse.json(
      { error: detail.error ?? "Receipt not found." },
      { status: detail.error === "Receipt not found." ? 404 : 500 },
    );
  }

  return NextResponse.json({
    receipt: detail.receipt,
    invoice: detail.invoice,
    business_unit_contact: await loadBusinessUnitDocumentContact(
      supabase,
      auth.tenantId,
      detail.receipt.business_unit_id,
    ),
  });
}
