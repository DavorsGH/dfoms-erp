import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { CRM_SECTION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  isMissingPaystackAttentionTable,
  PAYSTACK_ATTENTION_TABLE,
} from "@/utils/paystack-payment-attention";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  matchesBusinessUnitScope,
  snapshotBusinessUnitId,
} from "@/utils/cart-snapshot-business-unit";

export const runtime = "nodejs";

const ATTENTION_SELECT =
  "id, tenant_id, payment_request_id, paystack_reference, amount, customer_label, client_id, reason, status, created_at";

export async function GET() {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

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

  const rows = data ?? [];
  if (buScope.mode === "all" || rows.length === 0) {
    return NextResponse.json({ rows, unavailable: false });
  }

  const requestIds = [
    ...new Set(
      rows
        .map((row) => String(row.payment_request_id ?? ""))
        .filter(Boolean),
    ),
  ];
  const buByRequestId = new Map<string, string | null>();
  if (requestIds.length > 0) {
    const { data: requests } = await admin
      .from("product_sale_payment_requests")
      .select("id, cart_snapshot")
      .eq("tenant_id", auth.tenantId)
      .in("id", requestIds);
    for (const request of requests ?? []) {
      buByRequestId.set(
        String(request.id),
        snapshotBusinessUnitId(request.cart_snapshot),
      );
    }
  }

  const scopedRows = rows.filter((row) => {
    const requestId = String(row.payment_request_id ?? "");
    const buId = buByRequestId.get(requestId) ?? null;
    return matchesBusinessUnitScope(buId, buScope);
  });

  return NextResponse.json({ rows: scopedRows, unavailable: false });
}
