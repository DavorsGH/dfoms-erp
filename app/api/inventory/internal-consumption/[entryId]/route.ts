import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { INVENTORY_EDIT_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import {
  assertServerRowWriteAccess,
  getServerAuthUid,
} from "@/utils/business-unit-access.server";
import { logInventoryUserActivity } from "@/lib/inventory/inventory-audit-log";

type PatchBody = {
  consumption_date?: string;
  product_id?: string;
  quantity?: number;
  reason?: string | null;
  notes?: string | null;
  site_id?: string | null;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ entryId: string }> },
) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { entryId } = await context.params;
  if (!entryId?.trim()) {
    return NextResponse.json({ error: "Entry id is required." }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json(
      { error: "Quantity must be greater than zero." },
      { status: 400 },
    );
  }

  if (!body.product_id?.trim() || !body.consumption_date?.trim()) {
    return NextResponse.json(
      { error: "Product and consumption date are required." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const authUid = await getServerAuthUid(supabase);
  if (!authUid.ok) {
    return NextResponse.json({ error: authUid.error }, { status: authUid.status });
  }

  const rowAccess = await assertServerRowWriteAccess({
    supabase,
    tenantId: auth.tenantId,
    authUid: authUid.authUid,
    table: "internal_consumption",
    rowId: entryId,
  });
  if (!rowAccess.ok) {
    return NextResponse.json({ error: rowAccess.error }, { status: rowAccess.status });
  }

  const admin = createAdminClient();
  const { data: entryRow, error: entryError } = await admin
    .from("internal_consumption")
    .select("*")
    .eq("id", entryId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 500 });
  }
  if (!entryRow) {
    return NextResponse.json({ error: "Entry not found." }, { status: 404 });
  }

  const { error: rpcError } = await admin.rpc("update_internal_consumption_entry", {
    p_tenant_id: auth.tenantId,
    p_entry_id: entryId,
    p_consumption_date: body.consumption_date.trim().slice(0, 10),
    p_product_id: body.product_id.trim(),
    p_quantity: quantity,
    p_reason: body.reason ?? "",
    p_notes: body.notes ?? "",
    p_site_id: body.site_id?.trim() ? body.site_id.trim() : null,
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (rpcError) {
    await logInventoryUserActivity({
      tenantId: auth.tenantId,
      authUserId: authUid.authUid,
      email: user?.email,
      eventName: "inventory.internal_consumption.update",
      status: "failure",
      metadata: { entry_id: entryId, error: rpcError.message },
    });
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  await logInventoryUserActivity({
    tenantId: auth.tenantId,
    authUserId: authUid.authUid,
    email: user?.email,
    eventName: "inventory.internal_consumption.update",
    status: "success",
    metadata: {
      entry_id: entryId,
      before: entryRow,
      after: {
        consumption_date: body.consumption_date.trim().slice(0, 10),
        product_id: body.product_id.trim(),
        quantity,
        reason: body.reason ?? null,
        notes: body.notes ?? null,
        site_id: body.site_id ?? null,
      },
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ entryId: string }> },
) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { entryId } = await context.params;
  if (!entryId?.trim()) {
    return NextResponse.json({ error: "Entry id is required." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const authUid = await getServerAuthUid(supabase);
  if (!authUid.ok) {
    return NextResponse.json({ error: authUid.error }, { status: authUid.status });
  }

  const rowAccess = await assertServerRowWriteAccess({
    supabase,
    tenantId: auth.tenantId,
    authUid: authUid.authUid,
    table: "internal_consumption",
    rowId: entryId,
  });
  if (!rowAccess.ok) {
    return NextResponse.json({ error: rowAccess.error }, { status: rowAccess.status });
  }

  const admin = createAdminClient();
  const { data: entryRow, error: entryError } = await admin
    .from("internal_consumption")
    .select("*")
    .eq("id", entryId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 500 });
  }
  if (!entryRow) {
    return NextResponse.json({ error: "Entry not found." }, { status: 404 });
  }

  const { error: rpcError } = await admin.rpc("delete_internal_consumption_entry", {
    p_tenant_id: auth.tenantId,
    p_entry_id: entryId,
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (rpcError) {
    await logInventoryUserActivity({
      tenantId: auth.tenantId,
      authUserId: authUid.authUid,
      email: user?.email,
      eventName: "inventory.internal_consumption.delete",
      status: "failure",
      metadata: { entry_id: entryId, error: rpcError.message },
    });
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  await logInventoryUserActivity({
    tenantId: auth.tenantId,
    authUserId: authUid.authUid,
    email: user?.email,
    eventName: "inventory.internal_consumption.delete",
    status: "success",
    metadata: { entry_id: entryId, deleted: entryRow },
  });

  return NextResponse.json({ ok: true });
}
