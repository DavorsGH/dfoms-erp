import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import type { TenantStatus } from "@/utils/tenant-management";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

type UpdateTenantStatusBody = {
  tenant_id?: string;
  status?: TenantStatus;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateTenantStatusBody;
  try {
    body = (await request.json()) as UpdateTenantStatusBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { tenant_id, status } = body;

  if (!tenant_id || !status) {
    return NextResponse.json(
      { error: "tenant_id and status are required" },
      { status: 400 },
    );
  }

  if (tenant_id === DAVORS_TENANT_ID) {
    return NextResponse.json(
      { error: "The platform tenant cannot be modified from this screen." },
      { status: 400 },
    );
  }

  if (status !== "active" && status !== "suspended") {
    return NextResponse.json({ error: "Invalid tenant status." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: tenant, error: tenantLookupError } = await admin
    .from("tenants")
    .select("id")
    .eq("id", tenant_id)
    .maybeSingle();

  if (tenantLookupError) {
    return NextResponse.json({ error: tenantLookupError.message }, { status: 400 });
  }

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
  }

  const { error: updateError } = await admin
    .from("tenants")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", tenant_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, status });
}
