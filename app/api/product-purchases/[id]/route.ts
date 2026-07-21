import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { INVENTORY_EDIT_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Purchase id is required." }, { status: 400 });
  }

  const supabase = await getTenantSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from("product_purchases")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Purchase not found." }, { status: 404 });
  }

  const { error: deleteError } = await supabase.rpc("delete_product_purchase", {
    p_purchase_id: id,
  });

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
