import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import {
  buildUserAccountPayload,
  ensureClientAvailable,
  ensureEmployeeAvailable,
  validationErrorMessage,
} from "@/utils/admin-user-role";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  mapSupabasePasswordError,
  validatePasswordLength,
} from "@/utils/password-policy";
import { recordPasswordUpdatedAt } from "@/lib/security/password-updated-at";
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForEmail,
} from "@/lib/auth/cross-persona-guard";
import {
  assignStaffMembership,
  findAuthUserIdByEmail,
  findStaffAccountByEmail,
  REUSED_ACCOUNT_LOGIN_HINT,
} from "@/utils/email-reuse";

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

  if (!email || !role) {
    return NextResponse.json(
      { error: "email and role are required" },
      { status: 400 },
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

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

  const crossPersona = await findCrossPersonaConflictForEmail(
    admin,
    normalizedEmail,
  );
  if (crossPersona) {
    return NextResponse.json(
      { error: crossPersonaErrorMessage(crossPersona) },
      { status: 409 },
    );
  }

  if (built.payload.employee_id) {
    const employeeError = await ensureEmployeeAvailable(
      admin,
      built.payload.employee_id,
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
      tenantId,
    );
    if (clientError) {
      return NextResponse.json({ error: clientError }, { status: 409 });
    }
  }

  const existingAuthUserId = await findAuthUserIdByEmail(admin, normalizedEmail);
  const existingStaff = existingAuthUserId
    ? await findStaffAccountByEmail(admin, normalizedEmail)
    : null;

  if (existingAuthUserId) {
    if (existingStaff?.is_active) {
      return NextResponse.json(
        {
          error:
            "This email is in use by an active account at another business.",
        },
        { status: 409 },
      );
    }

    const assigned = await assignStaffMembership(admin, {
      authUid: existingAuthUserId,
      tenantId,
      role: built.payload.role,
      email: normalizedEmail,
      employeeId: built.payload.employee_id,
      clientId: built.payload.client_id,
      supervisorSiteCodes: built.supervisor_site_codes,
    });

    if (!assigned.ok) {
      return NextResponse.json({ error: assigned.error }, { status: 400 });
    }

    return NextResponse.json({
      auth_uid: existingAuthUserId,
      reusedExistingAccount: true,
      message: REUSED_ACCOUNT_LOGIN_HINT,
    });
  }

  if (!password) {
    return NextResponse.json(
      { error: "password is required for new accounts" },
      { status: 400 },
    );
  }

  const lengthError = validatePasswordLength(password);
  if (lengthError) {
    return NextResponse.json({ error: lengthError }, { status: 400 });
  }

  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
    });

  if (authError || !authData.user) {
    return NextResponse.json(
      {
        error: mapSupabasePasswordError(
          authError ?? { message: "Failed to create auth user" },
        ),
      },
      { status: 400 },
    );
  }

  const assigned = await assignStaffMembership(admin, {
    authUid: authData.user.id,
    tenantId,
    role: built.payload.role,
    email: normalizedEmail,
    employeeId: built.payload.employee_id,
    clientId: built.payload.client_id,
    supervisorSiteCodes: built.supervisor_site_codes,
  });

  if (!assigned.ok) {
    await admin.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: assigned.error }, { status: 400 });
  }

  await recordPasswordUpdatedAt(authData.user.id);

  return NextResponse.json({
    auth_uid: authData.user.id,
    reusedExistingAccount: false,
  });
}
