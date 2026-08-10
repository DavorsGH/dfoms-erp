import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { INVENTORY_EDIT_ROLES } from "@/utils/rbac-access";
import {
  PRODUCT_PURCHASE_LIST_SELECT,
  trimProductPurchaseInput,
  validateProductPurchaseBody,
  type ProductPurchaseListRow,
  type ProductPurchaseWriteBody,
} from "@/utils/product-purchases-types";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Purchase id is required." }, { status: 400 });
  }

  const supabase = await getTenantSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from("product_purchases")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Purchase not found." }, { status: 404 });
  }

  const { error: deleteError } = await supabase.rpc("delete_product_purchase", {
    p_purchase_id: id,
  });

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
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

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Purchase id is required." }, { status: 400 });
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

  const body = rawBody as ProductPurchaseWriteBody;
  const validationError = validateProductPurchaseBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimProductPurchaseInput(body);
  const supabase = await getTenantSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from("product_purchases")
    .select("id, product_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Purchase not found." }, { status: 404 });
  }

  if (existing.product_id !== trimmed.product_id) {
    return NextResponse.json(
      { error: "Product cannot be changed on an existing purchase." },
      { status: 400 },
    );
  }

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

  const { error: rpcError } = await supabase.rpc("update_product_purchase", {
    p_purchase_id: id,
    p_purchase_date: trimmed.purchase_date,
    p_quantity: trimmed.quantity,
    p_cost_per_unit: trimmed.cost_per_unit,
    p_supplier_id: trimmed.supplier_id,
    p_payment_method: trimmed.payment_method,
    p_notes: trimmed.notes,
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("product_purchases")
    .select(PRODUCT_PURCHASE_LIST_SELECT)
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    product_purchase: data as unknown as ProductPurchaseListRow,
  });
}
