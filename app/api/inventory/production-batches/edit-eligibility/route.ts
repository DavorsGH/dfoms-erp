import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { INVENTORY_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  const auth = await requireTenantRoleIn(INVENTORY_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: batches, error: batchError } = await supabase
    .from("production_batches")
    .select("id")
    .eq("tenant_id", auth.tenantId);

  if (batchError) {
    return NextResponse.json({ error: batchError.message }, { status: 500 });
  }

  const eligibility: Record<
    string,
    {
      can_edit: boolean;
      block_reason: string | null;
      consumed_quantity: number | null;
      sale_count: number | null;
    }
  > = {};

  for (const batch of batches ?? []) {
    const { data: previewRows, error: previewError } = await supabase.rpc(
      "preview_production_batch_edit",
      { p_batch_id: batch.id },
    );

    if (previewError) {
      return NextResponse.json({ error: previewError.message }, { status: 500 });
    }

    const preview = Array.isArray(previewRows) ? previewRows[0] : previewRows;
    eligibility[batch.id] = {
      can_edit: Boolean(preview?.can_edit),
      block_reason: preview?.block_reason ?? null,
      consumed_quantity:
        preview?.consumed_quantity == null
          ? null
          : Number(preview.consumed_quantity),
      sale_count:
        preview?.sale_count == null ? null : Number(preview.sale_count),
    };
  }

  return NextResponse.json({ eligibility });
}
