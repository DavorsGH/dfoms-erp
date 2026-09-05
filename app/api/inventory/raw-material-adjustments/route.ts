import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  resolveCreateBusinessUnitId,
  StampRefusedViewAllError,
} from "@/utils/business-unit-stamp";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  INVENTORY_EDIT_ROLES,
  INVENTORY_SECTION_ROLES,
} from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";
import {
  RAW_MATERIAL_ADJUSTMENT_TYPES,
  RAW_MATERIAL_STOCK_ADJUSTMENT_SELECT,
  type RawMaterialAdjustmentType,
  type RawMaterialStockAdjustmentRecord,
} from "@/app/dashboard/inventory/raw-materials-utils";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

type AdjustmentWriteBody = {
  material_id?: unknown;
  adjustment_type?: unknown;
  quantity_delta?: unknown;
  cost_per_unit?: unknown;
  reason?: unknown;
  notes?: unknown;
};

function isAdjustmentType(value: string): value is RawMaterialAdjustmentType {
  return (RAW_MATERIAL_ADJUSTMENT_TYPES as readonly string[]).includes(value);
}

function validateBody(body: AdjustmentWriteBody): string | null {
  if (typeof body.material_id !== "string" || !body.material_id.trim()) {
    return "Select a raw material.";
  }
  if (
    typeof body.adjustment_type !== "string" ||
    !isAdjustmentType(body.adjustment_type.trim())
  ) {
    return "Select a valid adjustment type.";
  }
  if (
    typeof body.quantity_delta !== "number" ||
    !Number.isFinite(body.quantity_delta) ||
    body.quantity_delta === 0
  ) {
    return "Quantity delta must be a non-zero number.";
  }
  if (typeof body.reason !== "string" || !body.reason.trim()) {
    return "Reason is required.";
  }

  const type = body.adjustment_type.trim() as RawMaterialAdjustmentType;
  if (
    (type === "opening_balance" || type === "found_stock") &&
    (body.cost_per_unit == null ||
      typeof body.cost_per_unit !== "number" ||
      !Number.isFinite(body.cost_per_unit))
  ) {
    return "Cost per unit is required for Opening Balance and Found Stock.";
  }

  if (
    body.cost_per_unit != null &&
    (typeof body.cost_per_unit !== "number" ||
      !Number.isFinite(body.cost_per_unit))
  ) {
    return "Cost per unit must be a valid number.";
  }

  if (body.notes != null && typeof body.notes !== "string") {
    return "Notes must be text.";
  }

  return null;
}

export async function GET() {
  const auth = await requireTenantRoleIn(INVENTORY_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("raw_material_stock_adjustments")
      .select(RAW_MATERIAL_STOCK_ADJUSTMENT_SELECT)
      .eq("tenant_id", auth.tenantId),
    buScope,
  )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    adjustments: (data ?? []) as unknown as RawMaterialStockAdjustmentRecord[],
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

  if (
    rawBody !== null &&
    typeof rawBody === "object" &&
    "tenant_id" in rawBody
  ) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client" },
      { status: 400 },
    );
  }

  const body = rawBody as AdjustmentWriteBody;
  const validationError = validateBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const materialId = String(body.material_id).trim();
  const adjustmentType = String(body.adjustment_type).trim() as RawMaterialAdjustmentType;
  const quantityDelta = Number(body.quantity_delta);
  const reason = String(body.reason).trim();
  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim()
      : null;
  const costPerUnit =
    adjustmentType === "opening_balance" || adjustmentType === "found_stock"
      ? Number(body.cost_per_unit)
      : null;

  let businessUnitId: string | null;
  try {
    businessUnitId = await resolveCreateBusinessUnitId();
  } catch (error) {
    if (error instanceof StampRefusedViewAllError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const supabase = await getTenantSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: adjustmentId, error: rpcError } = await supabase.rpc(
    "record_raw_material_manual_adjustment",
    {
      p_tenant_id: auth.tenantId,
      p_material_id: materialId,
      p_business_unit_id: businessUnitId,
      p_adjustment_type: adjustmentType,
      p_quantity_delta: quantityDelta,
      p_cost_per_unit: costPerUnit,
      p_reason: reason,
      p_notes: notes,
      p_created_by: user?.id ?? null,
    },
  );

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  const resolvedId =
    typeof adjustmentId === "string"
      ? adjustmentId
      : String(adjustmentId ?? "");

  if (!resolvedId) {
    return NextResponse.json(
      { error: "Adjustment was recorded but no id was returned." },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from("raw_material_stock_adjustments")
    .select(RAW_MATERIAL_STOCK_ADJUSTMENT_SELECT)
    .eq("id", resolvedId)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    adjustment: data as unknown as RawMaterialStockAdjustmentRecord,
  });
}
