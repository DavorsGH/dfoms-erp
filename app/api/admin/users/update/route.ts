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
import { syncAuthUserPortalMetadata } from "@/lib/auth/portal-metadata";
import { ADMIN_USER_UPDATE_FAILED } from "@/lib/administration/admin-user-auth-email-errors";
import { SELF_ROLE_ACCESS_CHANGE_MESSAGE } from "@/lib/auth/account-inactive-message";

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

  const { tenantId, userId } = auth;

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

  if (auth_uid === userId && is_active === false) {
    return NextResponse.json(
      { error: "You cannot deactivate your own account." },
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
    .select("auth_uid, email, is_active, role, employee_id, client_id")
    .eq("auth_uid", auth_uid)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existingAccount) {
    return NextResponse.json({ error: "User account not found" }, { status: 404 });
  }

  if (existingAccount.email?.toLowerCase() !== normalizedEmail) {
    return NextResponse.json(
      {
        error:
          "Use Change login email in Login access to change a user's email.",
      },
      { status: 400 },
    );
  }

  if (auth_uid === userId) {
    const { data: existingSites } = await admin
      .from("user_account_supervisor_sites")
      .select("site_code")
      .eq("auth_uid", auth_uid)
      .eq("tenant_id", tenantId);
    const existingSiteCodes = new Set(
      (existingSites ?? []).map((row) => row.site_code as string),
    );
    const nextSiteCodes = new Set(built.supervisor_site_codes);
    const sitesChanged =
      existingSiteCodes.size !== nextSiteCodes.size ||
      [...existingSiteCodes].some((code) => !nextSiteCodes.has(code));
    const roleChanged = built.payload.role !== existingAccount.role;
    const employeeChanged =
      (built.payload.employee_id ?? null) !==
      (existingAccount.employee_id ?? null);
    const clientChanged =
      (built.payload.client_id ?? null) !== (existingAccount.client_id ?? null);

    if (roleChanged || employeeChanged || clientChanged || sitesChanged) {
      return NextResponse.json(
        { error: SELF_ROLE_ACCESS_CHANGE_MESSAGE },
        { status: 400 },
      );
    }
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

  const { error: updateError } = await admin
    .from("user_accounts")
    .update({
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
    console.error("[admin/users/update] user_accounts update failed:", {
      auth_uid,
      tenantId,
      message: updateError.message,
    });
    return NextResponse.json({ error: ADMIN_USER_UPDATE_FAILED }, { status: 400 });
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

  await syncAuthUserPortalMetadata(auth_uid, "staff");

  return NextResponse.json({ success: true });
}
