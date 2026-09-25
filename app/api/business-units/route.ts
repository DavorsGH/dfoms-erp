import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import {
  assertCanDeactivateBusinessUnit,
  setTenantPrimaryBusinessUnit,
} from "@/utils/business-units-server";
import {
  BUSINESS_UNIT_SELECT,
  trimBusinessUnitInput,
  validateBusinessUnitInput,
  type BusinessUnitInput,
  type BusinessUnitRow,
  type BusinessUnitUpdateBody,
} from "@/utils/business-units-types";
import { createAdminClient } from "@/utils/supabase/admin";
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

async function clearActiveBusinessUnitPointers(
  tenantId: string,
  businessUnitId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { error: clearError } = await admin
    .from("user_accounts")
    .update({ active_business_unit_id: null })
    .eq("tenant_id", tenantId)
    .eq("active_business_unit_id", businessUnitId);

  return clearError?.message ?? null;
}

export async function GET() {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("business_units")
    .select(BUSINESS_UNIT_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    business_units: (data as BusinessUnitRow[] | null) ?? [],
  });
}

export async function POST(request: Request) {
  const auth = await requireTenantSuperAdmin();
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

  const body = rawBody as BusinessUnitInput;
  const validationError = validateBusinessUnitInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimBusinessUnitInput(body);
  const supabase = await getTenantSupabase();
  const admin = createAdminClient();

  const { count: primaryCount } = await admin
    .from("business_units")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", auth.tenantId)
    .eq("is_primary", true);

  const shouldBePrimary =
    trimmed.is_active !== false && (primaryCount ?? 0) === 0;

  const { data, error } = await supabase
    .from("business_units")
    .insert({
      tenant_id: auth.tenantId,
      name: trimmed.name,
      invoice_address: trimmed.invoice_address,
      business_email: trimmed.business_email,
      is_active: trimmed.is_active,
      is_primary: shouldBePrimary,
      ...(trimmed.logo_url !== undefined ? { logo_url: trimmed.logo_url } : {}),
      updated_at: new Date().toISOString(),
    })
    .select(BUSINESS_UNIT_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ business_unit: data as BusinessUnitRow });
}

export async function PUT(request: Request) {
  const auth = await requireTenantSuperAdmin();
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

  const body = rawBody as BusinessUnitUpdateBody;
  if (!body.id?.trim()) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const validationError = validateBusinessUnitInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimBusinessUnitInput(body);
  const supabase = await getTenantSupabase();
  const admin = createAdminClient();

  const { data: existing, error: fetchError } = await supabase
    .from("business_units")
    .select("id, is_active, is_primary")
    .eq("id", body.id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Business unit not found" }, { status: 404 });
  }

  if (
    trimmed.is_active === false &&
    existing.is_active === true
  ) {
    const guard = await assertCanDeactivateBusinessUnit(
      admin,
      auth.tenantId,
      body.id,
    );
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("business_units")
    .update({
      name: trimmed.name,
      invoice_address: trimmed.invoice_address,
      business_email: trimmed.business_email,
      is_active: trimmed.is_active,
      ...(trimmed.logo_url !== undefined ? { logo_url: trimmed.logo_url } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .eq("tenant_id", auth.tenantId)
    .select(BUSINESS_UNIT_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (trimmed.is_active === false && existing.is_active === true) {
    const clearError = await clearActiveBusinessUnitPointers(
      auth.tenantId,
      body.id,
    );
    if (clearError) {
      console.error(
        "[business-units] failed to clear active_business_unit_id on deactivate:",
        clearError,
      );
      return NextResponse.json(
        {
          error:
            "Business unit deactivated, but failed to reset users still pointing at it.",
          business_unit: data as BusinessUnitRow,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ business_unit: data as BusinessUnitRow });
}

type BusinessUnitPatchBody = {
  id: string;
  is_active?: boolean;
  set_primary?: boolean;
};

export async function PATCH(request: Request) {
  const auth = await requireTenantSuperAdmin();
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

  const body = rawBody as BusinessUnitPatchBody;
  if (!body.id?.trim()) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  if (body.set_primary === true) {
    const result = await setTenantPrimaryBusinessUnit(
      admin,
      auth.tenantId,
      body.id,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ business_unit: result.business_unit });
  }

  if (typeof body.is_active !== "boolean") {
    return NextResponse.json(
      { error: "is_active must be a boolean, or set set_primary to true" },
      { status: 400 },
    );
  }

  const supabase = await getTenantSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from("business_units")
    .select("id, is_active")
    .eq("id", body.id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Business unit not found" }, { status: 404 });
  }

  if (body.is_active === false && existing.is_active === true) {
    const guard = await assertCanDeactivateBusinessUnit(
      admin,
      auth.tenantId,
      body.id,
    );
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("business_units")
    .update({
      is_active: body.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .eq("tenant_id", auth.tenantId)
    .select(BUSINESS_UNIT_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (body.is_active === false) {
    const clearError = await clearActiveBusinessUnitPointers(
      auth.tenantId,
      body.id,
    );
    if (clearError) {
      console.error(
        "[business-units] failed to clear active_business_unit_id on deactivate:",
        clearError,
      );
      return NextResponse.json(
        {
          error:
            "Business unit deactivated, but failed to reset users still pointing at it.",
          business_unit: data as BusinessUnitRow,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ business_unit: data as BusinessUnitRow });
}
