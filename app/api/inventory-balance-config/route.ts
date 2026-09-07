import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  assertCanModifyBusinessUnitRow,
  BusinessUnitAccessDeniedError,
  getUserAllowedBusinessUnits,
} from "@/utils/business-unit-access";
import {
  fetchInventoryBalanceConfigRow,
  resolveInventoryBalanceConfigBusinessUnitId,
} from "@/utils/inventory-balance-config.server";
import {
  INVENTORY_BALANCE_CONFIG_ON_CONFLICT,
  INVENTORY_BALANCE_CONFIG_SELECT,
  normalizeInventoryBalanceConfigRow,
  type InventoryBalanceConfigRow,
  type InventoryBalanceConfigUpdateBody,
} from "@/utils/inventory-balance-config-types";
import { createClient } from "@/utils/supabase/server";

const INVENTORY_GO_LIVE_ROLES = ["super_admin", "finance", "director"] as const;

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let businessUnitId: string | null;
  try {
    businessUnitId = await resolveInventoryBalanceConfigBusinessUnitId(
      supabase,
      auth.tenantId,
      user.id,
    );
  } catch (accessError) {
    const status =
      accessError instanceof BusinessUnitAccessDeniedError ? 403 : 400;
    return NextResponse.json(
      {
        error:
          accessError instanceof Error
            ? accessError.message
            : "Business unit access denied.",
      },
      { status },
    );
  }

  const { data, error } = await fetchInventoryBalanceConfigRow(
    supabase,
    auth.tenantId,
    businessUnitId,
  );

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let businessUnitId: string | null;
  try {
    const allowedUnits = await getUserAllowedBusinessUnits(
      supabase,
      auth.tenantId,
      user.id,
    );

    businessUnitId = await resolveInventoryBalanceConfigBusinessUnitId(
      supabase,
      auth.tenantId,
      user.id,
    );

    const { data: existing, error: existingError } =
      await fetchInventoryBalanceConfigRow(
        supabase,
        auth.tenantId,
        businessUnitId,
      );

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 400 });
    }

    if (existing) {
      assertCanModifyBusinessUnitRow(
        allowedUnits,
        (existing as InventoryBalanceConfigRow).business_unit_id,
      );
    }
  } catch (accessError) {
    const status =
      accessError instanceof BusinessUnitAccessDeniedError ? 403 : 400;
    return NextResponse.json(
      {
        error:
          accessError instanceof Error
            ? accessError.message
            : "Business unit access denied.",
      },
      { status },
    );
  }

  const { data, error } = await supabase
    .from("inventory_balance_config")
    .upsert(
      {
        tenant_id: auth.tenantId,
        business_unit_id: businessUnitId,
        go_live_date: goLiveDate,
        opening_inventory_value: openingInventoryValue,
      },
      { onConflict: INVENTORY_BALANCE_CONFIG_ON_CONFLICT },
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
