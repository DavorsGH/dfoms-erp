import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import {
  buildUserAccountPayload,
  ensureClientAvailable,
  ensureEmployeeAvailable,
  syncSupervisorSites,
  validationErrorMessage,
} from "@/utils/admin-user-role";
import { createAdminClient } from "@/utils/supabase/admin";

type CreateUserBody = {
  employee_id?: string | null;
  email?: string;
  password?: string;
  role?: string;
  client_id?: string | null;
  supervisor_site_codes?: string[];
};

export async function POST(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

  let body: CreateUserBody;
  try {
    body = (await request.json()) as CreateUserBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, password, role, employee_id, client_id, supervisor_site_codes } =
    body;

  if (!email || !password || !role) {
    return NextResponse.json(
      { error: "email, password, and role are required" },
      { status: 400 },
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 },
    );
  }

  const built = buildUserAccountPayload({
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

  if (built.payload.employee_id) {
    const employeeError = await ensureEmployeeAvailable(
      admin,
      built.payload.employee_id,
      undefined,
      tenantId,
    );
    if (employeeError) {
      return NextResponse.json({ error: employeeError }, { status: 409 });
    }
  }

  if (built.payload.client_id) {
    const clientError = await ensureClientAvailable(
      admin,
      built.payload.client_id,
      undefined,
      tenantId,
    );
    if (clientError) {
      return NextResponse.json({ error: clientError }, { status: 409 });
    }
  }

  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (authError || !authData.user) {
    return NextResponse.json(
      { error: authError?.message ?? "Failed to create auth user" },
      { status: 400 },
    );
  }

  const { error: insertError } = await admin.from("user_accounts").insert({
    auth_uid: authData.user.id,
    employee_id: built.payload.employee_id,
    client_id: built.payload.client_id,
    role: built.payload.role,
    email,
    is_active: true,
    tenant_id: tenantId,
  });

  if (insertError) {
    await admin.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  const siteSyncError = await syncSupervisorSites(
    admin,
    authData.user.id,
    built.payload.role,
    built.supervisor_site_codes,
  );

  if (siteSyncError) {
    await admin.from("user_accounts").delete().eq("auth_uid", authData.user.id);
    await admin.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: siteSyncError }, { status: 400 });
  }

  return NextResponse.json({ auth_uid: authData.user.id });
}
