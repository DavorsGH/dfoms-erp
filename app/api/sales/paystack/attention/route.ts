import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { CRM_SECTION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  isMissingPaystackAttentionTable,
  PAYSTACK_ATTENTION_TABLE,
} from "@/utils/paystack-payment-attention";

export const runtime = "nodejs";

const ATTENTION_SELECT =
  "id, tenant_id, payment_request_id, paystack_reference, amount, customer_label, client_id, reason, status, created_at";

export async function GET() {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from(PAYSTACK_ATTENTION_TABLE)
    .select(ATTENTION_SELECT)
    .eq("tenant_id", auth.tenantId)
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingPaystackAttentionTable(error)) {
      return NextResponse.json({ rows: [], unavailable: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [], unavailable: false });
}
