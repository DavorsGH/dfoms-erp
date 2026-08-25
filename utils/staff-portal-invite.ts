import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildUserAccountPayload,
  ensureClientAvailable,
  ensureEmployeeAvailable,
  validationErrorMessage,
} from "@/utils/admin-user-role";
import { isAppRole } from "@/app/dashboard/user-account-role-utils";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForEmail,
} from "@/lib/auth/cross-persona-guard";
import { recordPasswordUpdatedAt } from "@/lib/security/password-updated-at";
import {
  assignStaffMembership,
  findAuthUserIdByEmail,
  findStaffAccountByEmail,
  REUSED_ACCOUNT_LOGIN_HINT,
} from "@/utils/email-reuse";
import {
  mapSupabasePasswordError,
  validatePasswordLength,
} from "@/utils/password-policy";
import { buildPortalInviteEmail } from "@/utils/portal-invite-email";
import { sendResendEmail } from "@/utils/resend-email";
import { resolvePublicSiteUrl } from "@/utils/public-site-url";

export const STAFF_INVITE_EXPIRY_DAYS = 7;

export function hashStaffInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateStaffInviteRawToken(): string {
  return randomBytes(32).toString("hex");
}

export type StaffInviteRoleInput = {
  tenantId: string;
  email: string;
  role: string;
  employee_id?: string | null;
  client_id?: string | null;
  supervisor_site_codes?: string[];
  invitedBy?: string | null;
};

export async function validateStaffInviteRoleInput(
  admin: SupabaseClient,
  input: StaffInviteRoleInput,
): Promise<
  | {
      ok: true;
      email: string;
      built: Extract<
        ReturnType<typeof buildUserAccountPayload>,
        { ok: true }
      >;
    }
  | { ok: false; error: string; status?: number }
> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    return { ok: false, error: "email is required", status: 400 };
  }

  if (!input.role) {
    return { ok: false, error: "role is required", status: 400 };
  }

  const built = buildUserAccountPayload({
    tenant_id: input.tenantId,
    role: input.role,
    employee_id: input.employee_id,
    client_id: input.client_id,
    supervisor_site_codes: input.supervisor_site_codes,
  });

  if (!built.ok) {
    return {
      ok: false,
      error: validationErrorMessage(built.errors),
      status: 400,
    };
  }

  if (built.payload.employee_id) {
    const employeeError = await ensureEmployeeAvailable(
      admin,
      built.payload.employee_id,
      input.tenantId,
    );
    if (employeeError) {
      return { ok: false, error: employeeError, status: 409 };
    }
  }

  if (built.payload.client_id) {
    const clientError = await ensureClientAvailable(
      admin,
      built.payload.client_id,
      input.tenantId,
    );
    if (clientError) {
      return { ok: false, error: clientError, status: 409 };
    }
  }

  const crossPersona = await findCrossPersonaConflictForEmail(admin, email);
  if (crossPersona) {
    return {
      ok: false,
      error: crossPersonaErrorMessage(crossPersona),
      status: 409,
    };
  }

  const { data: existingStaff } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("tenant_id", input.tenantId)
    .ilike("email", email)
    .maybeSingle();

  if (existingStaff) {
    return {
      ok: false,
      error:
        "A staff account with this email already exists in your organization.",
      status: 409,
    };
  }

  return { ok: true, email, built };
}

/**
 * Creates a single-use staff invite and sends email via Resend.
 * Invalidates outstanding unused invites for the same tenant + email.
 */
export async function createAndSendStaffPortalInvite(
  admin: SupabaseClient,
  input: StaffInviteRoleInput,
): Promise<
  | { ok: true; status: "sent"; invite_id: string }
  | { ok: false; error: string; status?: number }
> {
  const validated = await validateStaffInviteRoleInput(admin, input);
  if (!validated.ok) {
    return {
      ok: false,
      error: validated.error,
      status: validated.status,
    };
  }

  const { email, built } = validated;
  const rawToken = generateStaffInviteRawToken();
  const tokenHash = hashStaffInviteToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + STAFF_INVITE_EXPIRY_DAYS);

  await admin
    .from("staff_portal_invites")
    .update({ used_at: now.toISOString() })
    .eq("tenant_id", input.tenantId)
    .ilike("email", email)
    .is("used_at", null);

  const { data: inviteRow, error: insertError } = await admin
    .from("staff_portal_invites")
    .insert({
      tenant_id: input.tenantId,
      email,
      token_hash: tokenHash,
      role: built.payload.role,
      employee_id: built.payload.employee_id,
      client_id: built.payload.client_id,
      invited_by: input.invitedBy ?? null,
      expires_at: expiresAt.toISOString(),
      used_at: null,
      created_at: now.toISOString(),
    })
    .select("invite_id")
    .single();

  if (insertError || !inviteRow) {
    return {
      ok: false,
      error: insertError?.message ?? "Failed to create staff invite.",
      status: 400,
    };
  }

  if (built.supervisor_site_codes.length > 0) {
    const { error: sitesError } = await admin
      .from("staff_portal_invite_supervisor_sites")
      .insert(
        built.supervisor_site_codes.map((site_code) => ({
          invite_id: inviteRow.invite_id,
          site_code,
        })),
      );

    if (sitesError) {
      await admin
        .from("staff_portal_invites")
        .delete()
        .eq("invite_id", inviteRow.invite_id);
      return { ok: false, error: sitesError.message, status: 400 };
    }
  }

  const siteUrl = resolvePublicSiteUrl().replace(/\/$/, "");
  const inviteUrl = `${siteUrl}/accept-invite?token=${encodeURIComponent(rawToken)}`;
  const [inviterName, inviteeDisplayName] = await Promise.all([
    resolveStaffInviterDisplayName(admin, input.tenantId, input.invitedBy),
    resolveStaffInviteeDisplayName(admin, {
      employeeId: built.payload.employee_id,
      clientId: built.payload.client_id,
    }),
  ]);

  const content = buildPortalInviteEmail({
    portalName: "Staff ERP Portal",
    inviteeDisplayName,
    inviterLine: `${inviterName} has invited you to join the Staff ERP Portal.`,
    inviteUrl,
    expiryDays: STAFF_INVITE_EXPIRY_DAYS,
    subject: "You're invited to Davors Facilities ERP",
  });

  const emailResult = await sendResendEmail({
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  if (!emailResult.ok) {
    await admin
      .from("staff_portal_invites")
      .delete()
      .eq("invite_id", inviteRow.invite_id);
    return { ok: false, error: emailResult.error, status: 503 };
  }

  return { ok: true, status: "sent", invite_id: inviteRow.invite_id };
}

export type StaffInviteRow = {
  invite_id: string;
  tenant_id: string;
  email: string;
  role: string;
  employee_id: string | null;
  client_id: string | null;
  expires_at: string;
  used_at: string | null;
};

export async function loadStaffInviteByRawToken(
  admin: SupabaseClient,
  rawToken: string,
): Promise<
  | { ok: true; invite: StaffInviteRow }
  | { ok: false; error: string; status: number }
> {
  const tokenHash = hashStaffInviteToken(rawToken.trim());

  const { data: invite, error } = await admin
    .from("staff_portal_invites")
    .select(
      "invite_id, tenant_id, email, role, employee_id, client_id, expires_at, used_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }
  if (!invite) {
    return { ok: false, error: "This invite link is invalid.", status: 400 };
  }
  if (invite.used_at) {
    return {
      ok: false,
      error: "This invite link has already been used.",
      status: 400,
    };
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      error:
        "This invite link has expired. Ask your administrator for a new invite.",
      status: 400,
    };
  }

  return { ok: true, invite };
}

export async function loadStaffInviteSupervisorSites(
  admin: SupabaseClient,
  inviteId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from("staff_portal_invite_supervisor_sites")
    .select("site_code")
    .eq("invite_id", inviteId);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => row.site_code);
}

export type StaffInviteAcceptResult =
  | { ok: true; reusedExistingAccount: boolean }
  | { ok: false; error: string; status: number };

/**
 * Peek whether this invite email already has Auth credentials (sequential reuse).
 */
export async function staffInviteHasExistingAuthAccount(
  admin: SupabaseClient,
  rawToken: string,
): Promise<
  | { ok: true; existingAccount: boolean; email: string }
  | { ok: false; error: string; status: number }
> {
  const inviteResult = await loadStaffInviteByRawToken(admin, rawToken);
  if (!inviteResult.ok) {
    return {
      ok: false,
      error: inviteResult.error,
      status: inviteResult.status,
    };
  }
  const email = String(inviteResult.invite.email).trim().toLowerCase();
  const authUserId = await findAuthUserIdByEmail(admin, email);
  return { ok: true, existingAccount: Boolean(authUserId), email };
}

export async function acceptStaffPortalInviteWithPassword(
  admin: SupabaseClient,
  rawToken: string,
  password: string,
): Promise<StaffInviteAcceptResult> {
  const inviteResult = await loadStaffInviteByRawToken(admin, rawToken);
  if (!inviteResult.ok) {
    return {
      ok: false,
      error: inviteResult.error,
      status: inviteResult.status,
    };
  }

  const invite = inviteResult.invite;
  const email = String(invite.email).trim().toLowerCase();
  const nowIso = new Date().toISOString();

  if (!isAppRole(invite.role)) {
    return {
      ok: false,
      error:
        "This invite has an invalid role. Ask your administrator for a new invite.",
      status: 400,
    };
  }
  const role: AppRole = invite.role;

  const crossPersona = await findCrossPersonaConflictForEmail(admin, email);
  if (crossPersona) {
    return {
      ok: false,
      error: crossPersonaErrorMessage(crossPersona),
      status: 409,
    };
  }

  const { data: existingActiveInTenant } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("tenant_id", invite.tenant_id)
    .ilike("email", email)
    .eq("is_active", true)
    .maybeSingle();

  if (existingActiveInTenant) {
    return {
      ok: false,
      error:
        "A staff account with this email already exists. Please log in instead.",
      status: 400,
    };
  }

  let supervisorSiteCodes: string[] = [];
  try {
    supervisorSiteCodes = await loadStaffInviteSupervisorSites(
      admin,
      invite.invite_id,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load invite details.";
    return { ok: false, error: message, status: 400 };
  }

  const existingAuthUserId = await findAuthUserIdByEmail(admin, email);
  const existingStaff = existingAuthUserId
    ? await findStaffAccountByEmail(admin, email)
    : null;

  if (existingAuthUserId) {
    if (existingStaff?.is_active) {
      return {
        ok: false,
        error:
          "This email is in use by an active account at another business.",
        status: 409,
      };
    }

    const assigned = await assignStaffMembership(admin, {
      authUid: existingAuthUserId,
      tenantId: invite.tenant_id,
      role,
      email,
      employeeId: invite.employee_id,
      clientId: invite.client_id,
      supervisorSiteCodes,
    });

    if (!assigned.ok) {
      return { ok: false, error: assigned.error, status: 400 };
    }

    const { error: markUsedError } = await admin
      .from("staff_portal_invites")
      .update({ used_at: nowIso })
      .eq("invite_id", invite.invite_id)
      .is("used_at", null);

    if (markUsedError) {
      return {
        ok: false,
        error: `Account linked, but invite could not be marked used: ${markUsedError.message}`,
        status: 400,
      };
    }

    return { ok: true, reusedExistingAccount: true };
  }

  const lengthError = validatePasswordLength(password);
  if (lengthError) {
    return { ok: false, error: lengthError, status: 400 };
  }

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        portal: "staff",
      },
    });

  if (createError || !created.user) {
    const message = createError?.message ?? "Unable to create portal account.";
    if (/already|registered|exists/i.test(message)) {
      const authConflict = await findCrossPersonaConflictForEmail(admin, email);
      if (authConflict) {
        return {
          ok: false,
          error: crossPersonaErrorMessage(authConflict),
          status: 409,
        };
      }
      return {
        ok: false,
        error:
          "An account with this email already exists. Try logging in, or contact support if you need help.",
        status: 400,
      };
    }
    return {
      ok: false,
      error: mapSupabasePasswordError(createError ?? { message }),
      status: 400,
    };
  }

  const authUserId = created.user.id;
  await recordPasswordUpdatedAt(authUserId);

  const assigned = await assignStaffMembership(admin, {
    authUid: authUserId,
    tenantId: invite.tenant_id,
    role,
    email,
    employeeId: invite.employee_id,
    clientId: invite.client_id,
    supervisorSiteCodes,
  });

  if (!assigned.ok) {
    await admin.auth.admin.deleteUser(authUserId);
    return { ok: false, error: assigned.error, status: 400 };
  }

  const { error: markUsedError } = await admin
    .from("staff_portal_invites")
    .update({ used_at: nowIso })
    .eq("invite_id", invite.invite_id)
    .is("used_at", null);

  if (markUsedError) {
    return {
      ok: false,
      error: `Account created, but invite could not be marked used: ${markUsedError.message}`,
      status: 400,
    };
  }

  return { ok: true, reusedExistingAccount: false };
}

/**
 * Resolve invitee greeting name from linked employee or customer, matching
 * Lessee/FM/Landlord fallback to "there" when no display name is available.
 */
async function resolveStaffInviteeDisplayName(
  admin: SupabaseClient,
  ids: { employeeId?: string | null; clientId?: string | null },
): Promise<string> {
  const employeeId = ids.employeeId?.trim() || null;
  if (employeeId) {
    const { data: employee } = await admin
      .from("employees")
      .select("full_name")
      .eq("employee_id", employeeId)
      .maybeSingle();
    const fullName =
      typeof employee?.full_name === "string" ? employee.full_name.trim() : "";
    if (fullName) {
      return fullName;
    }
  }

  const clientId = ids.clientId?.trim() || null;
  if (clientId) {
    const { data: client } = await admin
      .from("customers")
      .select("client_name")
      .eq("client_id", clientId)
      .maybeSingle();
    const clientName =
      typeof client?.client_name === "string" ? client.client_name.trim() : "";
    if (clientName) {
      return clientName;
    }
  }

  return "there";
}

async function resolveStaffInviterDisplayName(
  admin: SupabaseClient,
  tenantId: string,
  invitedBy: string | null | undefined,
): Promise<string> {
  const authUid = invitedBy?.trim();
  if (!authUid) {
    return "Your administrator";
  }

  const { data: account } = await admin
    .from("user_accounts")
    .select("email, employee_id, client_id")
    .eq("tenant_id", tenantId)
    .eq("auth_uid", authUid)
    .maybeSingle();

  if (!account) {
    return "Your administrator";
  }

  if (account.employee_id) {
    const { data: employee } = await admin
      .from("employees")
      .select("full_name")
      .eq("employee_id", account.employee_id)
      .maybeSingle();
    const fullName =
      typeof employee?.full_name === "string"
        ? employee.full_name.trim()
        : "";
    if (fullName) {
      return fullName;
    }
  }

  if (account.client_id) {
    const { data: client } = await admin
      .from("customers")
      .select("client_name")
      .eq("client_id", account.client_id)
      .maybeSingle();
    const clientName =
      typeof client?.client_name === "string"
        ? client.client_name.trim()
        : "";
    if (clientName) {
      return clientName;
    }
  }

  const email =
    typeof account.email === "string" ? account.email.trim() : "";
  if (email) {
    return email;
  }

  return "Your administrator";
}

export { REUSED_ACCOUNT_LOGIN_HINT };
