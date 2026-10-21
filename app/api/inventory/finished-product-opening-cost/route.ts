import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { guardFinishedProductWriteBusinessUnit } from "@/lib/inventory/inventory-item-business-unit-guard.server";
import { mapFinishedProductStockAdjustmentErrorMessage } from "@/lib/inventory/inventory-mutation-error";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { resolveServerWriteBusinessUnitId } from "@/utils/business-unit-access.server";
import { FINISHED_PRODUCT_OPENING_COST_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

type OpeningCostBody = {
  product_id?: unknown;
  cost_per_unit?: unknown;
};

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(FINISHED_PRODUCT_OPENING_COST_ROLES);
  if (!auth.ok) {
    return auth.response;
  }
  const tenantId = auth.tenantId;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const body = rawBody as OpeningCostBody;
  const productId = typeof body.product_id === "string" ? body.product_id.trim() : "";
  const costPerUnit =
    typeof body.cost_per_unit === "number" ? body.cost_per_unit : Number.NaN;
  if (!productId) {
    return NextResponse.json({ error: "Select a finished product." }, { status: 400 });
  }
  if (!Number.isFinite(costPerUnit) || costPerUnit <= 0) {
    return NextResponse.json(
      { error: "Enter a cost per unit greater than zero." },
      { status: 400 },
    );
  }

  const supabase = await getTenantSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const writeBu = await resolveServerWriteBusinessUnitId({
    supabase,
    tenantId: auth.tenantId,
    authUid: user.id,
    requireExplicitSwitcherSelection: true,
  });
  if (!writeBu.ok) {
    return NextResponse.json({ error: writeBu.error }, { status: writeBu.status });
  }
  const businessUnitId = writeBu.businessUnitId;

  const productBuGuard = await guardFinishedProductWriteBusinessUnit({
    supabase,
    tenantId: auth.tenantId,
    productId,
    writeBusinessUnitId: businessUnitId,
    action: "stock_adjustment",
  });
  if (!productBuGuard.ok) {
    return NextResponse.json(
      { error: productBuGuard.error },
      { status: productBuGuard.status },
    );
  }

  let balanceQuery = supabase
    .from("finished_product_balances")
    .select("current_stock, average_cost_per_unit")
    .eq("tenant_id", auth.tenantId)
    .eq("product_id", productId);
  balanceQuery =
    businessUnitId == null
      ? balanceQuery.is("business_unit_id", null)
      : balanceQuery.eq("business_unit_id", businessUnitId);

  const { data: balance, error: balanceError } = await balanceQuery.maybeSingle();
  if (balanceError) {
    return NextResponse.json(
      { error: mapFinishedProductStockAdjustmentErrorMessage(balanceError) },
      { status: 400 },
    );
  }

  const stock = Number(balance?.current_stock) || 0;
  if (stock <= 0) {
    return NextResponse.json(
      { error: "This product has no stock in the selected business unit." },
      { status: 400 },
    );
  }

  const { data: outflowCost, error: outflowCostError } = await supabase.rpc(
    "finished_product_inventory_outflow_unit_cost",
    {
      p_product_id: productId,
      p_business_unit_id: businessUnitId,
    },
  );
  if (outflowCostError) {
    return NextResponse.json(
      { error: mapFinishedProductStockAdjustmentErrorMessage(outflowCostError) },
      { status: 400 },
    );
  }
  if (Number(outflowCost) > 0) {
    return NextResponse.json(
      { error: "This product already has a cost in the selected business unit." },
      { status: 400 },
    );
  }

  async function recordAdjustment(input: {
    type: "correction" | "opening_balance";
    quantityDelta: number;
    cost: number | null;
    reason: string;
  }) {
    return supabase.rpc("record_finished_product_manual_adjustment", {
      p_tenant_id: tenantId,
      p_product_id: productId,
      p_business_unit_id: businessUnitId,
      p_adjustment_type: input.type,
      p_quantity_delta: input.quantityDelta,
      p_cost_per_unit: input.cost,
      p_reason: input.reason,
      p_notes: "Set opening cost for stock that had no cost",
      p_created_by: user?.id ?? null,
      p_manufacturing_date: null,
      p_expiration_date: null,
    });
  }

  const cleared = await recordAdjustment({
    type: "correction",
    quantityDelta: -stock,
    cost: null,
    reason: "Clear uncosted quantity before opening cost",
  });
  if (cleared.error) {
    return NextResponse.json(
      { error: mapFinishedProductStockAdjustmentErrorMessage(cleared.error) },
      { status: 400 },
    );
  }

  const opened = await recordAdjustment({
    type: "opening_balance",
    quantityDelta: stock,
    cost: costPerUnit,
    reason: "Opening cost for stock already on hand",
  });
  if (opened.error) {
    const restored = await recordAdjustment({
      type: "correction",
      quantityDelta: stock,
      cost: null,
      reason: "Restore quantity after opening cost failed",
    });
    const mapped = mapFinishedProductStockAdjustmentErrorMessage(opened.error);
    if (restored.error) {
      return NextResponse.json(
        {
          error: `${mapped} The quantity could not be put back automatically. Check the stock adjustment list before trying again.`,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: mapped }, { status: 400 });
  }

  const { data: updatedBalance } = await balanceQuery.maybeSingle();
  const { data: outflowAfter } = await supabase.rpc(
    "finished_product_inventory_outflow_unit_cost",
    {
      p_product_id: productId,
      p_business_unit_id: businessUnitId,
    },
  );
  const resultingAverage = Number(updatedBalance?.average_cost_per_unit);
  const resultingOutflow = Number(outflowAfter);

  return NextResponse.json({
    ok: true,
    entered_cost: costPerUnit,
    average_cost_per_unit: Number.isFinite(resultingAverage)
      ? resultingAverage
      : costPerUnit,
    outflow_unit_cost: Number.isFinite(resultingOutflow) ? resultingOutflow : 0,
  });
}
