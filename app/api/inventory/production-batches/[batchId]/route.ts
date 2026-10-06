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
import { validateProductionBatchMaterialLines } from "@/lib/inventory/production-batch-form-validation";
import { mapProductionBatchSaveErrorMessage } from "@/lib/inventory/production-batch-save-error";

type PatchBody = {
  production_date?: string;
  finished_product_id?: string;
  quantity_produced?: number;
  notes?: string | null;
  manufacturing_date?: string | null;
  expiration_date?: string | null;
  materials?: Array<{
    material_id: string;
    quantity_used: number;
    cost_at_time: number;
  }>;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { batchId } = await context.params;
  if (!batchId?.trim()) {
    return NextResponse.json({ error: "Batch id is required." }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
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
    table: "production_batches",
    rowId: batchId,
  });
  if (!rowAccess.ok) {
    return NextResponse.json({ error: rowAccess.error }, { status: rowAccess.status });
  }

  const admin = createAdminClient();
  const { data: batchRow, error: batchError } = await admin
    .from("production_batches")
    .select(
      "id, batch_number, business_unit_id, production_date, finished_product_id, quantity_produced, total_batch_cost, notes, manufacturing_date, expiration_date",
    )
    .eq("id", batchId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (batchError) {
    return NextResponse.json({ error: batchError.message }, { status: 500 });
  }
  if (!batchRow) {
    return NextResponse.json({ error: "Production batch not found." }, { status: 404 });
  }

  const quantityProduced = Number(body.quantity_produced);
  if (!Number.isFinite(quantityProduced) || quantityProduced <= 0) {
    return NextResponse.json(
      { error: "Quantity produced must be greater than zero." },
      { status: 400 },
    );
  }

  if (!body.finished_product_id?.trim()) {
    return NextResponse.json(
      { error: "Finished product is required." },
      { status: 400 },
    );
  }

  if (!body.production_date?.trim()) {
    return NextResponse.json(
      { error: "Production date is required." },
      { status: 400 },
    );
  }

  const materials = body.materials ?? [];
  if (materials.length === 0) {
    return NextResponse.json(
      { error: "Add at least one raw material with a quantity used." },
      { status: 400 },
    );
  }

  const materialIds = [
    ...new Set(
      materials
        .map((line) => String(line.material_id ?? "").trim())
        .filter(Boolean),
    ),
  ];

  const { data: materialRows, error: materialLookupError } = await admin
    .from("raw_materials")
    .select("id, material_name, current_stock, average_cost_per_unit")
    .eq("tenant_id", auth.tenantId)
    .in("id", materialIds);

  if (materialLookupError) {
    console.error("production batch material lookup failed", materialLookupError);
    return NextResponse.json(
      { error: "Couldn't save the production batch. Please try again." },
      { status: 500 },
    );
  }

  const materialValidation = validateProductionBatchMaterialLines({
    lines: materials.map((line) => ({
      material_id: String(line.material_id ?? ""),
      quantity_used: String(line.quantity_used ?? ""),
    })),
    materials: (materialRows ?? []).map((row) => ({
      id: String(row.id),
      material_name: String(row.material_name ?? ""),
      current_stock: Number(row.current_stock) || 0,
      average_cost_per_unit:
        row.average_cost_per_unit == null
          ? null
          : Number(row.average_cost_per_unit),
    })),
    resolveCost: (material) => material.average_cost_per_unit,
  });

  if (!materialValidation.ok) {
    const firstLineError = Object.values(materialValidation.lineErrors)[0];
    const message =
      firstLineError?.material ??
      firstLineError?.quantity ??
      materialValidation.formError ??
      "Check the material lines and try again.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { error: rpcError } = await admin.rpc("update_production_batch", {
    p_tenant_id: auth.tenantId,
    p_batch_id: batchId,
    p_production_date: body.production_date.trim().slice(0, 10),
    p_finished_product_id: body.finished_product_id.trim(),
    p_quantity_produced: quantityProduced,
    p_notes: body.notes ?? "",
    p_materials: materials,
    p_manufacturing_date: body.manufacturing_date?.trim()
      ? body.manufacturing_date.trim().slice(0, 10)
      : null,
    p_expiration_date: body.expiration_date?.trim()
      ? body.expiration_date.trim().slice(0, 10)
      : null,
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (rpcError) {
    console.error("update_production_batch failed", rpcError);
    await logInventoryUserActivity({
      tenantId: auth.tenantId,
      authUserId: authUid.authUid,
      email: user?.email,
      eventName: "inventory.production_batch.update",
      status: "failure",
      metadata: {
        batch_id: batchId,
        batch_number: batchRow.batch_number,
        error: rpcError.message,
      },
    });
    return NextResponse.json(
      { error: mapProductionBatchSaveErrorMessage(rpcError) },
      { status: 400 },
    );
  }

  await logInventoryUserActivity({
    tenantId: auth.tenantId,
    authUserId: authUid.authUid,
    email: user?.email,
    eventName: "inventory.production_batch.update",
    status: "success",
    metadata: {
      batch_id: batchId,
      batch_number: batchRow.batch_number,
      before: batchRow,
      after: {
        production_date: body.production_date.trim().slice(0, 10),
        finished_product_id: body.finished_product_id.trim(),
        quantity_produced: quantityProduced,
        notes: body.notes ?? null,
        manufacturing_date: body.manufacturing_date ?? null,
        expiration_date: body.expiration_date ?? null,
        materials,
      },
    },
  });

  return NextResponse.json({ ok: true });
}
