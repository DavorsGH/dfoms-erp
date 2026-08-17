import type { SupabaseClient } from "@supabase/supabase-js";
import { isAppRole } from "@/app/dashboard/user-account-role-utils";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForAuthUid,
  findCrossPersonaConflictForEmail,
} from "@/lib/auth/cross-persona-guard";
import { normalizeOAuthEmail } from "@/lib/auth/oauth-persona-resolve";
import { syncAuthUserPortalMetadata } from "@/lib/auth/portal-metadata";
import { syncSupervisorSites } from "@/utils/admin-user-role";
import { hashLandlordInviteToken } from "@/utils/landlord-portal-invite";
import { hashLesseeInviteToken } from "@/utils/lessee-portal-invite";
import {
  loadStaffInviteByRawToken,
  loadStaffInviteSupervisorSites,
} from "@/utils/staff-portal-invite";

type AcceptResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

function inviteEmailMismatch(inviteEmail: string, oauthEmail: string): boolean {
  return normalizeOAuthEmail(inviteEmail) !== normalizeOAuthEmail(oauthEmail);
}

export async function acceptStaffInviteWithOAuth(
  admin: SupabaseClient,
  authUserId: string,
  oauthEmail: string,
  rawToken: string,
): Promise<AcceptResult> {
  const inviteResult = await loadStaffInviteByRawToken(admin, rawToken);
  if (!inviteResult.ok) {
    return {
      ok: false,
      error: inviteResult.error,
      status: inviteResult.status,
    };
  }

  const invite = inviteResult.invite;
  const inviteEmail = String(invite.email).trim().toLowerCase();

  if (inviteEmailMismatch(inviteEmail, oauthEmail)) {
    return {
      ok: false,
      error: `This invite was sent to ${inviteEmail}. Sign in with that email address to accept it.`,
      status: 400,
    };
  }

  if (!isAppRole(invite.role)) {
    return {
      ok: false,
      error:
        "This invite has an invalid role. Ask your administrator for a new invite.",
      status: 400,
    };
  }
  const role: AppRole = invite.role;

  const crossByAuth = await findCrossPersonaConflictForAuthUid(admin, authUserId);
  if (crossByAuth) {
    return {
      ok: false,
      error: crossPersonaErrorMessage(crossByAuth),
      status: 409,
    };
  }

  const crossByEmail = await findCrossPersonaConflictForEmail(admin, inviteEmail);
  if (crossByEmail) {
    return {
      ok: false,
      error: crossPersonaErrorMessage(crossByEmail),
      status: 409,
    };
  }

  const { data: existingStaffInTenant } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("tenant_id", invite.tenant_id)
    .ilike("email", inviteEmail)
    .maybeSingle();

  if (existingStaffInTenant) {
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

  const nowIso = new Date().toISOString();

  const { error: insertError } = await admin.from("user_accounts").insert({
    auth_uid: authUserId,
    tenant_id: invite.tenant_id,
    role,
    employee_id: invite.employee_id,
    client_id: invite.client_id,
    email: inviteEmail,
    is_active: true,
  });

  if (insertError) {
    return { ok: false, error: insertError.message, status: 400 };
  }

  const siteSyncError = await syncSupervisorSites(
    admin,
    authUserId,
    role,
    supervisorSiteCodes,
    invite.tenant_id,
  );

  if (siteSyncError) {
    await admin.from("user_accounts").delete().eq("auth_uid", authUserId);
    return { ok: false, error: siteSyncError, status: 400 };
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

  await syncAuthUserPortalMetadata(authUserId, "staff");
  return { ok: true };
}

export async function acceptLesseeInviteWithOAuth(
  admin: SupabaseClient,
  authUserId: string,
  oauthEmail: string,
  rawToken: string,
): Promise<AcceptResult> {
  const tokenHash = hashLesseeInviteToken(rawToken.trim());
  const nowIso = new Date().toISOString();

  const { data: invite, error: inviteError } = await admin
    .from("lessee_portal_invites")
    .select("invite_id, tenant_id, lessee_id, email, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (inviteError) {
    return { ok: false, error: inviteError.message, status: 400 };
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
        "This invite link has expired. Ask your property manager for a new invite.",
      status: 400,
    };
  }

  const inviteEmail = String(invite.email).trim().toLowerCase();
  if (inviteEmailMismatch(inviteEmail, oauthEmail)) {
    return {
      ok: false,
      error: `This invite was sent to ${inviteEmail}. Sign in with that email address to accept it.`,
      status: 400,
    };
  }

  const crossByAuth = await findCrossPersonaConflictForAuthUid(admin, authUserId);
  if (crossByAuth) {
    return {
      ok: false,
      error: crossPersonaErrorMessage(crossByAuth),
      status: 409,
    };
  }

  const crossByEmail = await findCrossPersonaConflictForEmail(admin, inviteEmail);
  if (crossByEmail) {
    return {
      ok: false,
      error: crossPersonaErrorMessage(crossByEmail),
      status: 409,
    };
  }

  const { data: lessee } = await admin
    .from("lessees")
    .select("lessee_id, auth_user_id, full_name")
    .eq("tenant_id", invite.tenant_id)
    .eq("lessee_id", invite.lessee_id)
    .maybeSingle();

  if (!lessee) {
    return {
      ok: false,
      error: "Tenant record not found for this invite.",
      status: 404,
    };
  }
  if (lessee.auth_user_id) {
    return {
      ok: false,
      error: "This tenant already has a portal account. Please log in.",
      status: 400,
    };
  }

  const { error: linkError } = await admin
    .from("lessees")
    .update({ auth_user_id: authUserId, updated_at: nowIso })
    .eq("tenant_id", invite.tenant_id)
    .eq("lessee_id", invite.lessee_id)
    .is("auth_user_id", null);

  if (linkError) {
    return { ok: false, error: linkError.message, status: 400 };
  }

  const { error: markUsedError } = await admin
    .from("lessee_portal_invites")
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

  await syncAuthUserPortalMetadata(authUserId, "lessee");
  return { ok: true };
}

export async function acceptLandlordInviteWithOAuth(
  admin: SupabaseClient,
  authUserId: string,
  oauthEmail: string,
  rawToken: string,
): Promise<AcceptResult> {
  const tokenHash = hashLandlordInviteToken(rawToken.trim());
  const nowIso = new Date().toISOString();

  const { data: invite, error: inviteError } = await admin
    .from("landlord_portal_invites")
    .select("invite_id, tenant_id, email, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (inviteError) {
    return { ok: false, error: inviteError.message, status: 400 };
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
        "This invite link has expired. Ask Davors staff for a new invite.",
      status: 400,
    };
  }

  const inviteEmail = String(invite.email).trim().toLowerCase();
  if (inviteEmailMismatch(inviteEmail, oauthEmail)) {
    return {
      ok: false,
      error: `This invite was sent to ${inviteEmail}. Sign in with that email address to accept it.`,
      status: 400,
    };
  }

  const crossByAuth = await findCrossPersonaConflictForAuthUid(admin, authUserId);
  if (crossByAuth) {
    return {
      ok: false,
      error: crossPersonaErrorMessage(crossByAuth),
      status: 409,
    };
  }

  const crossByEmail = await findCrossPersonaConflictForEmail(admin, inviteEmail);
  if (crossByEmail) {
    return {
      ok: false,
      error: crossPersonaErrorMessage(crossByEmail),
      status: 409,
    };
  }

  const { data: landlord } = await admin
    .from("landlords")
    .select("tenant_id, auth_user_id, approval_status")
    .eq("tenant_id", invite.tenant_id)
    .maybeSingle();

  if (!landlord) {
    return {
      ok: false,
      error: "Landlord record not found for this invite.",
      status: 404,
    };
  }
  if (landlord.approval_status !== "approved") {
    return {
      ok: false,
      error: "This landlord account is not approved for portal access.",
      status: 400,
    };
  }
  if (landlord.auth_user_id) {
    return {
      ok: false,
      error: "This landlord already has a portal account. Please log in.",
      status: 400,
    };
  }

  const { error: linkError } = await admin
    .from("landlords")
    .update({ auth_user_id: authUserId, updated_at: nowIso })
    .eq("tenant_id", invite.tenant_id)
    .is("auth_user_id", null);

  if (linkError) {
    return { ok: false, error: linkError.message, status: 400 };
  }

  const { error: markUsedError } = await admin
    .from("landlord_portal_invites")
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

  await syncAuthUserPortalMetadata(authUserId, "landlord");
  return { ok: true };
}
