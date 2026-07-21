import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  INVENTORY_BALANCE_CONFIG_SELECT,
  normalizeInventoryBalanceConfigRow,
  type InventoryBalanceConfigRow,
  type InventoryBalanceConfigUpdateBody,
} from "@/utils/inventory-balance-config-types";
import { createClient } from "@/utils/supabase/server";

const INVENTORY_GO_LIVE_ROLES = ["super_admin", "finance"] as const;

async function getTenantSupabase() {
  return createClient(await cookies());
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET() {
  const auth = await requireTenantRoleIn(INVENTORY_GO_LIVE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("inventory_balance_config")
    .select(INVENTORY_BALANCE_CONFIG_SELECT)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    inventory_balance_config: data
      ? normalizeInventoryBalanceConfigRow(data as InventoryBalanceConfigRow)
      : null,
  });
}

export async function PUT(request: Request) {
  const auth = await requireTenantRoleIn(INVENTORY_GO_LIVE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (
    rawBody === null ||
    typeof rawBody !== "object" ||
    "tenant_id" in rawBody
  ) {
    return NextResponse.json(
      {
        error:
          rawBody !== null &&
          typeof rawBody === "object" &&
          "tenant_id" in rawBody
            ? "tenant_id cannot be set by client"
            : "Invalid request body.",
      },
      { status: 400 },
    );
  }

  const body = rawBody as InventoryBalanceConfigUpdateBody;
  const goLiveDate =
    typeof body.go_live_date === "string" ? body.go_live_date.trim() : "";
  const openingInventoryValue = Number(body.opening_inventory_value);

  if (!isValidDate(goLiveDate)) {
    return NextResponse.json(
      { error: "Go-live date must be a valid date." },
      { status: 400 },
    );
  }

  if (!Number.isFinite(openingInventoryValue) || openingInventoryValue < 0) {
    return NextResponse.json(
      { error: "Opening inventory value must be zero or greater." },
      { status: 400 },
    );
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("inventory_balance_config")
    .upsert(
      {
        tenant_id: auth.tenantId,
        go_live_date: goLiveDate,
        opening_inventory_value: openingInventoryValue,
      },
      { onConflict: "tenant_id" },
    )
    .select(INVENTORY_BALANCE_CONFIG_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    inventory_balance_config: normalizeInventoryBalanceConfigRow(
      data as InventoryBalanceConfigRow,
    ),
  });
}
