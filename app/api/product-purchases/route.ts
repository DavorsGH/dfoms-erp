import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  INVENTORY_EDIT_ROLES,
  INVENTORY_SECTION_ROLES,
} from "@/utils/rbac-access";
import {
  PRODUCT_PURCHASE_LIST_SELECT,
  trimProductPurchaseInput,
  validateProductPurchaseBody,
  type ProductPurchaseListRow,
  type ProductPurchaseWriteBody,
} from "@/utils/product-purchases-types";
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
    .from("product_purchases")
    .select(PRODUCT_PURCHASE_LIST_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("purchase_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    product_purchases: ((data ?? []) as unknown as ProductPurchaseListRow[]),
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

  const body = rawBody as ProductPurchaseWriteBody;
  const validationError = validateProductPurchaseBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimProductPurchaseInput(body);
  const supabase = await getTenantSupabase();

  const { data: product, error: productError } = await supabase
    .from("finished_products")
    .select("id, sourcing_type")
    .eq("id", trimmed.product_id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 400 });
  }

  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  if (product.sourcing_type !== "purchased") {
    return NextResponse.json(
      { error: "Only purchased finished products can be bought through this screen." },
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

  const { data: purchaseId, error: rpcError } = await supabase.rpc(
    "create_product_purchase",
    {
      p_purchase_date: trimmed.purchase_date,
      p_product_id: trimmed.product_id,
      p_quantity: trimmed.quantity,
      p_cost_per_unit: trimmed.cost_per_unit,
      p_supplier_id: trimmed.supplier_id,
      p_payment_method: trimmed.payment_method,
      p_notes: trimmed.notes,
    },
  );

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  const resolvedPurchaseId =
    typeof purchaseId === "string" ? purchaseId : String(purchaseId ?? "");

  if (!resolvedPurchaseId) {
    return NextResponse.json(
      { error: "Purchase was created but no id was returned." },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from("product_purchases")
    .select(PRODUCT_PURCHASE_LIST_SELECT)
    .eq("id", resolvedPurchaseId)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    product_purchase: data as unknown as ProductPurchaseListRow,
  });
}
