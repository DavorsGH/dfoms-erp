import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { INVENTORY_EDIT_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";
import {
  resolveServerWriteBusinessUnitId,
  getServerAuthUid,
} from "@/utils/business-unit-access.server";
import { logInventoryUserActivity } from "@/lib/inventory/inventory-audit-log";
import { mapInternalConsumptionMutationErrorMessage } from "@/lib/inventory/inventory-mutation-error";

type PostBody = {
  product_id?: string;
  quantity?: number;
  consumption_date?: string;
  reason?: string | null;
  notes?: string | null;
  site_id?: string | null;
  recorded_by?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json(
      { error: "Quantity must be greater than zero." },
      { status: 400 },
    );
  }

  if (!body.product_id?.trim() || !body.consumption_date?.trim()) {
    return NextResponse.json(
      { error: "Product and consumption date are required." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const authUid = await getServerAuthUid(supabase);
  if (!authUid.ok) {
    return NextResponse.json({ error: authUid.error }, { status: authUid.status });
  }

  const writeBu = await resolveServerWriteBusinessUnitId({
    supabase,
    tenantId: auth.tenantId,
    authUid: authUid.authUid,
  });
  if (!writeBu.ok) {
    return NextResponse.json({ error: writeBu.error }, { status: writeBu.status });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("internal_consumption")
    .insert({
      tenant_id: auth.tenantId,
      product_id: body.product_id.trim(),
      quantity,
      consumption_date: body.consumption_date.trim().slice(0, 10),
      reason: body.reason?.trim() ? body.reason.trim() : null,
      notes: body.notes?.trim() ? body.notes.trim() : null,
      recorded_by: body.recorded_by?.trim() ? body.recorded_by.trim() : null,
      site_id: body.site_id?.trim() ? body.site_id.trim() : null,
      business_unit_id: writeBu.businessUnitId,
    })
    .select("id")
    .single();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (insertError) {
    await logInventoryUserActivity({
      tenantId: auth.tenantId,
      authUserId: authUid.authUid,
      email: user?.email,
      eventName: "inventory.internal_consumption.create",
      status: "failure",
      metadata: { error: insertError.message },
    });
    return NextResponse.json(
      { error: mapInternalConsumptionMutationErrorMessage(insertError) },
      { status: 400 },
    );
  }

  await logInventoryUserActivity({
    tenantId: auth.tenantId,
    authUserId: authUid.authUid,
    email: user?.email,
    eventName: "inventory.internal_consumption.create",
    status: "success",
    metadata: { entry_id: inserted?.id },
  });

  return NextResponse.json({ ok: true, id: inserted?.id ?? null });
}
