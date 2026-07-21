import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  INVENTORY_EDIT_ROLES,
  INVENTORY_SECTION_ROLES,
} from "@/utils/rbac-access";
import {
  SUPPLIER_SELECT,
  trimSupplierInput,
  validateSupplierInput,
  type SupplierInput,
  type SupplierRow,
} from "@/utils/suppliers-types";
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
    .from("suppliers")
    .select(SUPPLIER_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    suppliers: (data as SupplierRow[] | null) ?? [],
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

  const body = rawBody as SupplierInput;
  const validationError = validateSupplierInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimSupplierInput(body);
  const supabase = await getTenantSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      tenant_id: auth.tenantId,
      ...trimmed,
      created_at: now,
      updated_at: now,
    })
    .select(SUPPLIER_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ supplier: data as SupplierRow });
}
