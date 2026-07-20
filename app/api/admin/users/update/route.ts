import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import {
  buildUserAccountPayload,
  ensureClientAvailable,
  ensureEmailAvailable,
  ensureEmployeeAvailable,
  syncSupervisorSites,
  validationErrorMessage,
} from "@/utils/admin-user-role";
import { createAdminClient } from "@/utils/supabase/admin";

type UpdateUserBody = {
  auth_uid?: string;
  email?: string;
  role?: string;
  employee_id?: string | null;
  client_id?: string | null;
  supervisor_site_codes?: string[];
  is_active?: boolean;
};

export async function POST(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

  let body: UpdateUserBody;
  try {
    body = (await request.json()) as UpdateUserBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
    auth_uid,
    email,
    role,
    employee_id,
    client_id,
    supervisor_site_codes,
    is_active,
  } = body;

  if (!auth_uid || !role || !email?.trim()) {
    return NextResponse.json(
      { error: "auth_uid, role, and email are required" },
      { status: 400 },
    );
  }

  const built = buildUserAccountPayload({
    tenant_id: tenantId,
    role,
    employee_id,
    client_id,
    supervisor_site_codes,
  });

  if (!built.ok) {
    return NextResponse.json(
      { error: validationErrorMessage(built.errors) },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const normalizedEmail = email.trim().toLowerCase();

  const { data: existingAccount, error: fetchError } = await admin
    .from("user_accounts")
    .select("auth_uid, email, is_active")
    .eq("auth_uid", auth_uid)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existingAccount) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  const emailError = await ensureEmailAvailable(
    admin,
    normalizedEmail,
    tenantId,
    auth_uid,
  );
  if (emailError) {
    return NextResponse.json({ error: emailError }, { status: 409 });
  }

  if (built.payload.employee_id) {
    const employeeError = await ensureEmployeeAvailable(
      admin,
      built.payload.employee_id,
      tenantId,
      auth_uid,
    );
    if (employeeError) {
      return NextResponse.json({ error: employeeError }, { status: 409 });
    }
  }

  if (built.payload.client_id) {
    const clientError = await ensureClientAvailable(
      admin,
      built.payload.client_id,
      tenantId,
      auth_uid,
    );
    if (clientError) {
      return NextResponse.json({ error: clientError }, { status: 409 });
    }
  }

  if (existingAccount.email?.toLowerCase() !== normalizedEmail) {
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(
      auth_uid,
      { email: normalizedEmail },
    );

    if (authUpdateError) {
      return NextResponse.json(
        { error: authUpdateError.message },
        { status: 400 },
      );
    }
  }

  const { error: updateError } = await admin
    .from("user_accounts")
    .update({
      email: normalizedEmail,
      role: built.payload.role,
      employee_id: built.payload.employee_id,
      client_id: built.payload.client_id,
      ...(typeof is_active === "boolean"
        ? { is_active }
        : { is_active: existingAccount.is_active }),
    })
    .eq("auth_uid", auth_uid)
    .eq("tenant_id", tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const siteSyncError = await syncSupervisorSites(
    admin,
    auth_uid,
    built.payload.role,
    built.supervisor_site_codes,
    tenantId,
  );

  if (siteSyncError) {
    return NextResponse.json({ error: siteSyncError }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
