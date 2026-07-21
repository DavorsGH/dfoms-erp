import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  INVENTORY_EDIT_ROLES,
  INVENTORY_SECTION_ROLES,
} from "@/utils/rbac-access";
import {
  PURCHASE_ORDER_LIST_SELECT,
  normalizePurchaseOrderListRow,
  trimPurchaseOrderInput,
  validatePurchaseOrderBody,
  type PurchaseOrderListRow,
  type PurchaseOrderWriteBody,
} from "@/utils/purchase-orders-types";
import { createClient } from "@/utils/supabase/server";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

function rejectClientTenantId(body: unknown): NextResponse | null {
  if (body !== null && typeof body === "object" && "tenant_id" in body) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client" },
      { status: 400 },
    );
  }

  return null;
}

export async function GET() {
  const auth = await requireTenantRoleIn(INVENTORY_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(PURCHASE_ORDER_LIST_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    purchase_orders: ((data ?? []) as unknown as PurchaseOrderListRow[]).map(
      (row) => normalizePurchaseOrderListRow(row),
    ),
  });
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tenantRejection = rejectClientTenantId(rawBody);
  if (tenantRejection) {
    return tenantRejection;
  }

  const body = rawBody as PurchaseOrderWriteBody;
  const validationError = validatePurchaseOrderBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimPurchaseOrderInput(body);
  const supabase = await getTenantSupabase();

  const { data: supplier, error: supplierError } = await supabase
    .from("suppliers")
    .select("id, is_active")
    .eq("id", trimmed.supplier_id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (supplierError) {
    return NextResponse.json({ error: supplierError.message }, { status: 400 });
  }

  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
  }

  if (!supplier.is_active) {
    return NextResponse.json(
      { error: "Selected supplier is inactive. Choose an active supplier." },
      { status: 400 },
    );
  }

  const { data: poId, error: rpcError } = await supabase.rpc(
    "create_purchase_order",
    {
      p_supplier_id: trimmed.supplier_id,
      p_order_date: trimmed.order_date,
      p_expected_date: trimmed.expected_date,
      p_notes: trimmed.notes,
      p_items: trimmed.items,
    },
  );

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  const resolvedPoId = typeof poId === "string" ? poId : String(poId ?? "");

  if (!resolvedPoId) {
    return NextResponse.json(
      { error: "Purchase order was created but no id was returned." },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from("purchase_orders")
    .select(PURCHASE_ORDER_LIST_SELECT)
    .eq("id", resolvedPoId)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    purchase_order: normalizePurchaseOrderListRow(
      data as unknown as PurchaseOrderListRow,
    ),
  });
}
