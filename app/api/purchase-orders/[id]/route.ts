import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { INVENTORY_EDIT_ROLES } from "@/utils/rbac-access";
import {
  PURCHASE_ORDER_DETAIL_SELECT,
  buildPurchaseOrderDeleteBlockedMessage,
  normalizePurchaseOrderDeletePreview,
  normalizePurchaseOrderDetail,
  type PurchaseOrderDeleteConfirmBody,
  type PurchaseOrderDetailRow,
} from "@/utils/purchase-orders-types";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const status =
    rawBody !== null && typeof rawBody === "object" && "status" in rawBody
      ? (rawBody as { status?: unknown }).status
      : undefined;

  if (status !== "sent") {
    return NextResponse.json(
      { error: "Only a status change to 'sent' is supported." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: existing, error: existingError } = await supabase
    .from("purchase_orders")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json(
      { error: "Purchase order not found." },
      { status: 404 },
    );
  }

  if (existing.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft purchase orders can be marked as sent." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("purchase_orders")
    .update({ status: "sent", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select(PURCHASE_ORDER_DETAIL_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    purchase_order: normalizePurchaseOrderDetail(
      data as unknown as PurchaseOrderDetailRow,
    ),
  });
}

async function readConfirmedFlag(request: Request): Promise<boolean> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return false;
  }

  try {
    const body = (await request.json()) as PurchaseOrderDeleteConfirmBody;
    return body.confirmed === true;
  } catch {
    return false;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: "Purchase order id is required." },
      { status: 400 },
    );
  }

  const confirmed = await readConfirmedFlag(request);
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: existing, error: fetchError } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json(
      { error: "Purchase order not found." },
      { status: 404 },
    );
  }

  const { data: previewData, error: previewError } = await supabase.rpc(
    "preview_purchase_order_delete",
    { p_po_id: id },
  );

  if (previewError) {
    return NextResponse.json({ error: previewError.message }, { status: 400 });
  }

  const preview = normalizePurchaseOrderDeletePreview(previewData);

  if (!preview.can_delete) {
    return NextResponse.json(
      {
        preview,
        can_delete: false,
        error: buildPurchaseOrderDeleteBlockedMessage(preview),
      },
      { status: 409 },
    );
  }

  if (!confirmed) {
    return NextResponse.json({
      preview,
      can_delete: true,
      requires_confirmation: true,
    });
  }

  const { error: deleteError } = await supabase.rpc("delete_purchase_order", {
    p_po_id: id,
  });

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
