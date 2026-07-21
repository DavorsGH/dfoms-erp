import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { INVENTORY_EDIT_ROLES } from "@/utils/rbac-access";
import {
  SUPPLIER_SELECT,
  buildSupplierDeleteBlockedMessage,
  normalizeSupplierDeletePreview,
  trimSupplierInput,
  validateSupplierInput,
  type SupplierDeleteConfirmBody,
  type SupplierInput,
  type SupplierRow,
} from "@/utils/suppliers-types";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Supplier id is required." }, { status: 400 });
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

  const { data: existing, error: fetchError } = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("suppliers")
    .update({
      ...trimmed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select(SUPPLIER_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ supplier: data as SupplierRow });
}

async function readConfirmedFlag(request: Request): Promise<boolean> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return false;
  }

  try {
    const body = (await request.json()) as SupplierDeleteConfirmBody;
    return body.confirmed === true;
  } catch {
    return false;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Supplier id is required." }, { status: 400 });
  }

  const confirmed = await readConfirmedFlag(request);
  const supabase = await getTenantSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
  }

  const { data: previewData, error: previewError } = await supabase.rpc(
    "preview_supplier_delete",
    { p_supplier_id: id },
  );

  if (previewError) {
    return NextResponse.json({ error: previewError.message }, { status: 400 });
  }

  const preview = normalizeSupplierDeletePreview(previewData);

  if (!preview.can_delete) {
    return NextResponse.json(
      {
        preview,
        can_delete: false,
        error: buildSupplierDeleteBlockedMessage(preview),
      },
      { status: 409 },
    );
  }

  if (!confirmed) {
    return NextResponse.json({
      preview,
      can_delete: true,
      requires_confirmation: true,
    });
  }

  const { error: deleteError } = await supabase.rpc("delete_supplier", {
    p_supplier_id: id,
  });

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
