import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { STAFF_BUSINESS_UNIT_SWITCHER_ROLES } from "@/app/dashboard/user-account-role-utils";
import { getCurrentAuthUid } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  BU_SELECTION_ALL,
  BU_SELECTION_DEFAULT,
  BU_SELECTION_UNIT,
  VIEW_ALL_BUSINESS_UNITS_FIELD,
  resolveBusinessUnitSelection,
  type BusinessUnitSelection,
} from "@/utils/business-unit-view";

type Body = {
  selection?: BusinessUnitSelection;
  business_unit_id?: string | null;
  view_all_business_units?: boolean;
};

/**
 * Persist staff business-unit switcher context.
 * Body: { selection: "all" | "default" | "unit", business_unit_id?: string | null }
 * - all → view_all_business_units true (keeps prior active_business_unit_id as memory)
 * - default → view_all false, active_business_unit_id null
 * - unit → view_all false, active_business_unit_id = uuid
 */
export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(STAFF_BUSINESS_UNIT_SWITCHER_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const authUid = await getCurrentAuthUid();
  if (!authUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (rawBody === null || typeof rawBody !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if ("tenant_id" in rawBody) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client" },
      { status: 400 },
    );
  }

  const body = rawBody as Body;
  let selection = body.selection;

  // Back-compat: older clients sent only business_unit_id (null = All).
  if (
    selection !== BU_SELECTION_ALL &&
    selection !== BU_SELECTION_DEFAULT &&
    selection !== BU_SELECTION_UNIT
  ) {
    if (body.view_all_business_units === true) {
      selection = BU_SELECTION_ALL;
    } else if (body.business_unit_id == null || body.business_unit_id === "") {
      // Ambiguous legacy null — treat as All only if explicitly flagged; else default.
      selection = BU_SELECTION_DEFAULT;
    } else {
      selection = BU_SELECTION_UNIT;
    }
  }

  const rawId = body.business_unit_id;
  if (rawId !== null && rawId !== undefined && typeof rawId !== "string") {
    return NextResponse.json(
      { error: "business_unit_id must be a string or null" },
      { status: 400 },
    );
  }

  const businessUnitId =
    rawId === null || rawId === undefined ? null : rawId.trim() || null;

  const admin = createAdminClient();

  if (selection === BU_SELECTION_UNIT) {
    if (!businessUnitId) {
      return NextResponse.json(
        { error: "business_unit_id is required when selection is unit" },
        { status: 400 },
      );
    }

    const { data: unit, error: unitError } = await admin
      .from("business_units")
      .select("id, tenant_id, is_active")
      .eq("id", businessUnitId)
      .maybeSingle();

    if (unitError) {
      return NextResponse.json({ error: unitError.message }, { status: 400 });
    }

    if (!unit) {
      return NextResponse.json(
        { error: "Business unit not found" },
        { status: 404 },
      );
    }

    if (unit.tenant_id !== auth.tenantId) {
      return NextResponse.json(
        { error: "Business unit does not belong to your workspace" },
        { status: 403 },
      );
    }

    if (unit.is_active !== true) {
      return NextResponse.json(
        { error: "Business unit is not active" },
        { status: 400 },
      );
    }
  }

  const patch: {
    view_all_business_units: boolean;
    active_business_unit_id?: string | null;
  } = {
    view_all_business_units: selection === BU_SELECTION_ALL,
  };

  if (selection === BU_SELECTION_ALL) {
    // Keep active_business_unit_id as last scoped memory; do not clear.
  } else if (selection === BU_SELECTION_DEFAULT) {
    patch.active_business_unit_id = null;
  } else {
    patch.active_business_unit_id = businessUnitId;
  }

  const { data, error } = await admin
    .from("user_accounts")
    .update(patch)
    .eq("auth_uid", authUid)
    .eq("tenant_id", auth.tenantId)
    .select("active_business_unit_id, view_all_business_units")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  const viewAll = data.view_all_business_units === true;
  const activeId = data.active_business_unit_id ?? null;

  return NextResponse.json({
    active_business_unit_id: activeId,
    [VIEW_ALL_BUSINESS_UNITS_FIELD]: viewAll,
    selection: resolveBusinessUnitSelection({
      viewAllBusinessUnits: viewAll,
      activeBusinessUnitId: activeId,
    }),
  });
}
