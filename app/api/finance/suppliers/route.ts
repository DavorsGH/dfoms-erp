import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
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

export async function GET() {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
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

  return NextResponse.json({ suppliers: (data as SupplierRow[] | null) ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: SupplierInput;
  try {
    body = (await request.json()) as SupplierInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const validationError = validateSupplierInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimSupplierInput(body);
  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      tenant_id: auth.tenantId,
      ...trimmed,
    })
    .select(SUPPLIER_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ supplier: data });
}
