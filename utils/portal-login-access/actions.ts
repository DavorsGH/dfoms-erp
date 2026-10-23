import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import {
  mapSupabaseAuthEmailError,
  mapSupabaseCreateUserError,
} from "@/lib/administration/admin-user-auth-email-errors";
import {
  mapSupabasePasswordError,
  validatePasswordLength,
} from "@/utils/password-policy";
import { recordPasswordUpdatedAt } from "@/lib/security/password-updated-at";
import { writePortalLoginAccessAudit } from "./audit";
import {
  findAuthUserIdByEmailAcrossAllPages,
  isValidEmailFormat,
  loadAuthUserSnapshot,
} from "./auth-email";
import { notifyLoginEmailChanged, notifyTemporaryPasswordSet } from "./notify";
import { sendPortalRecoveryEmail } from "./reset-link";
import {
  findSharedLoginLinks,
  formatSharedLoginSummary,
} from "./shared-login";
import {
  assertActorMayManageTarget,
  resolvePortalLoginTarget,
} from "./target-resolve";
import { buildMustChangeAppMetadata } from "./temp-password";
import type {
  PortalLoginActorPersona,
  PortalLoginAuthStatus,
  PortalLoginTargetRef,
  PortalLoginVerificationMethod,
  ResolvedPortalLoginTarget,
  SharedLoginLink,
} from "./types";
import {
  SHARED_LOGIN_NON_DAVORS_REFUSAL_MESSAGE,
} from "./types";

export type ActionContext = {
  actorPath: "admin" | "landlord" | "tenant_admin";
  actorAuthUid: string;
  actorTenantId: string;
  actorPersona: PortalLoginActorPersona;
};

type ActionFailure = {
  ok: false;
  error: string;
  status: number;
  code?:
    | "shared_login_requires_confirmation"
    | "shared_login_refused"
    | "notification_failed";
  sharedLinks?: SharedLoginLink[];
  field?: string;
};

async function loadAuthorizedTarget(
  ctx: ActionContext,
  ref: PortalLoginTargetRef,
): Promise<
  | {
      ok: true;
      target: ResolvedPortalLoginTarget;
      admin: ReturnType<typeof createAdminClient>;
    }
  | ActionFailure
> {
  const admin = createAdminClient();
  const resolved = await resolvePortalLoginTarget(admin, ref);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      status: resolved.status,
    };
  }

  const allowed = assertActorMayManageTarget({
    actorPath: ctx.actorPath,
    actorTenantId: ctx.actorTenantId,
    target: resolved.target,
  });
  if (!allowed.ok) {
    return { ok: false, error: allowed.error, status: allowed.status };
  }

  if (
    resolved.target.persona === "staff" &&
    resolved.target.recordId === ctx.actorAuthUid
  ) {
    return {
      ok: false,
      error:
        "You cannot manage login access for your own account. Use Forgot password or change password from My Account.",
      status: 403,
    };
  }

  return { ok: true, target: resolved.target, admin };
}

async function enforceSharedLogin(
  ctx: ActionContext,
  admin: ReturnType<typeof createAdminClient>,
  authUserId: string,
  target: {
    persona: PortalLoginTargetRef["persona"];
    recordId: string;
    tenantId: string;
  },
  confirmSharedLogin: boolean,
): Promise<{ ok: true } | ActionFailure> {
  const sharedLinks = await findSharedLoginLinks(admin, authUserId, {
    persona: target.persona,
    recordId: target.recordId,
    tenantId: target.tenantId,
  });
  if (sharedLinks.length === 0) {
    return { ok: true };
  }

  if (ctx.actorPath === "landlord" || ctx.actorPath === "tenant_admin") {
    return {
      ok: false,
      error: SHARED_LOGIN_NON_DAVORS_REFUSAL_MESSAGE,
      status: 409,
      code: "shared_login_refused",
      sharedLinks,
    };
  }

  if (!confirmSharedLogin) {
    return {
      ok: false,
      error: `This login is also attached to: ${formatSharedLoginSummary(sharedLinks)}. Confirm to continue.`,
      status: 409,
      code: "shared_login_requires_confirmation",
      sharedLinks,
    };
  }

  return { ok: true };
}

export async function getPortalLoginAccessStatus(
  ctx: ActionContext,
  ref: PortalLoginTargetRef,
): Promise<{ ok: true; status: PortalLoginAuthStatus } | ActionFailure> {
  const loaded = await loadAuthorizedTarget(ctx, ref);
  if (!loaded.ok) return loaded;

  const { admin, target } = loaded;
  const auth = await loadAuthUserSnapshot(admin, target.authUserId);
  const sharedLinks =
    auth.exists && target.authUserId
      ? await findSharedLoginLinks(admin, target.authUserId, {
          persona: target.persona,
          recordId: target.recordId,
          tenantId: target.tenantId,
        })
      : [];

  return {
    ok: true,
    status: {
      authUserExists: auth.exists,
      authUserId: auth.exists ? target.authUserId : null,
      loginEmail: auth.exists ? auth.email : null,
      lastSignInAt: auth.exists ? auth.lastSignInAt : null,
      isSuspended: auth.exists ? auth.isSuspended : false,
      sharedLinks,
      profileEmail: target.profileEmail,
      displayName: target.displayName,
      landlordType: target.landlordType,
    },
  };
}

export async function sendPortalLoginResetLink(
  ctx: ActionContext,
  options: {
    ref: PortalLoginTargetRef;
    verificationMethod: PortalLoginVerificationMethod;
    reason: string;
    confirmSharedLogin: boolean;
  },
): Promise<{ ok: true; message: string } | ActionFailure> {
  const loaded = await loadAuthorizedTarget(ctx, options.ref);
  if (!loaded.ok) return loaded;
  const { admin, target } = loaded;

  if (!target.authUserId) {
    return {
      ok: false,
      error: "No Auth login exists for this user yet. Use Create login.",
      status: 400,
    };
  }

  const auth = await loadAuthUserSnapshot(admin, target.authUserId);
  if (!auth.exists || !auth.email) {
    return {
      ok: false,
      error: "Auth account is missing. Use Create login to repair it.",
      status: 400,
    };
  }

  const shared = await enforceSharedLogin(
    ctx,
    admin,
    target.authUserId,
    target,
    options.confirmSharedLogin,
  );
  if (!shared.ok) return shared;

  const sent = await sendPortalRecoveryEmail({
    email: auth.email,
    persona: target.persona,
  });
  if (!sent.ok) {
    return { ok: false, error: sent.error, status: 400 };
  }

  await writePortalLoginAccessAudit(admin, {
    actorAuthUid: ctx.actorAuthUid,
    actorPersona: ctx.actorPersona,
    actorTenantId: ctx.actorTenantId,
    targetPersona: target.persona,
    targetRecordId: target.recordId,
    targetAuthUid: target.authUserId,
    action: "reset_link_sent",
    oldEmail: auth.email,
    newEmail: auth.email,
    verificationMethod: options.verificationMethod,
    reason: options.reason,
  });

  return { ok: true, message: "Password reset link sent." };
}

export async function setPortalLoginTemporaryPassword(
  ctx: ActionContext,
  options: {
    ref: PortalLoginTargetRef;
    password: string;
    verificationMethod: PortalLoginVerificationMethod;
    reason: string;
    confirmSharedLogin: boolean;
  },
): Promise<{ ok: true; message: string; notificationFailed?: boolean } | ActionFailure> {
  const loaded = await loadAuthorizedTarget(ctx, options.ref);
  if (!loaded.ok) return loaded;
  const { admin, target } = loaded;

  if (!target.authUserId) {
    return {
      ok: false,
      error: "No Auth login exists for this user yet. Use Create login.",
      status: 400,
    };
  }

  const lengthError = validatePasswordLength(options.password);
  if (lengthError) {
    return { ok: false, error: lengthError, status: 400, field: "password" };
  }

  const auth = await loadAuthUserSnapshot(admin, target.authUserId);
  if (!auth.exists) {
    return {
      ok: false,
      error: "Auth account is missing. Use Create login to repair it.",
      status: 400,
    };
  }

  const shared = await enforceSharedLogin(
    ctx,
    admin,
    target.authUserId,
    target,
    options.confirmSharedLogin,
  );
  if (!shared.ok) return shared;

  const { error: updateError } = await admin.auth.admin.updateUserById(
    target.authUserId,
    {
      password: options.password,
      app_metadata: buildMustChangeAppMetadata(auth.appMetadata),
    },
  );
  if (updateError) {
    return {
      ok: false,
      error: mapSupabasePasswordError(updateError),
      status: 400,
      field: "password",
    };
  }

  const signOut = admin.auth.admin.signOut as
    | ((
        userId: string,
        scope?: "global" | "local" | "others",
      ) => Promise<{ error: Error | null }>)
    | undefined;
  if (typeof signOut === "function") {
    await signOut.call(admin.auth.admin, target.authUserId, "global");
  }

  await recordPasswordUpdatedAt(target.authUserId);

  await writePortalLoginAccessAudit(admin, {
    actorAuthUid: ctx.actorAuthUid,
    actorPersona: ctx.actorPersona,
    actorTenantId: ctx.actorTenantId,
    targetPersona: target.persona,
    targetRecordId: target.recordId,
    targetAuthUid: target.authUserId,
    action: "temp_password_set",
    oldEmail: auth.email,
    newEmail: auth.email,
    verificationMethod: options.verificationMethod,
    reason: options.reason,
  });

  let notificationFailed = false;
  if (auth.email) {
    const notified = await notifyTemporaryPasswordSet({
      loginEmail: auth.email,
      actorPersona: ctx.actorPersona,
      created: false,
    });
    if (!notified.ok) {
      notificationFailed = true;
    }
  }

  return {
    ok: true,
    message: "Temporary password set.",
    notificationFailed,
  };
}

export async function changePortalLoginEmail(
  ctx: ActionContext,
  options: {
    ref: PortalLoginTargetRef;
    newEmail: string;
    alsoUpdateProfileEmail: boolean;
    verificationMethod: PortalLoginVerificationMethod;
    reason: string;
    confirmSharedLogin: boolean;
  },
): Promise<{ ok: true; message: string; notificationFailed?: boolean } | ActionFailure> {
  const loaded = await loadAuthorizedTarget(ctx, options.ref);
  if (!loaded.ok) return loaded;
  const { admin, target } = loaded;

  if (!target.authUserId) {
    return {
      ok: false,
      error: "No Auth login exists for this user yet. Use Create login.",
      status: 400,
    };
  }

  const newEmail = options.newEmail.trim().toLowerCase();
  if (!isValidEmailFormat(newEmail)) {
    return {
      ok: false,
      error: "Please enter a valid email address.",
      status: 400,
      field: "email",
    };
  }

  const auth = await loadAuthUserSnapshot(admin, target.authUserId);
  if (!auth.exists) {
    return {
      ok: false,
      error: "Auth account is missing. Use Create login to repair it.",
      status: 400,
    };
  }

  const shared = await enforceSharedLogin(
    ctx,
    admin,
    target.authUserId,
    target,
    options.confirmSharedLogin,
  );
  if (!shared.ok) return shared;

  const existingOwner = await findAuthUserIdByEmailAcrossAllPages(
    admin,
    newEmail,
  );
  if (existingOwner && existingOwner !== target.authUserId) {
    return {
      ok: false,
      error:
        "This email is already used by another login on the platform. Use a different email or contact support.",
      status: 409,
      field: "email",
    };
  }

  const oldEmail = auth.email;
  if (oldEmail !== newEmail) {
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(
      target.authUserId,
      { email: newEmail, email_confirm: true },
    );
    if (authUpdateError) {
      return {
        ok: false,
        error: mapSupabaseAuthEmailError(authUpdateError, "update"),
        status: 400,
        field: "email",
      };
    }
  }

  // Staff login email is also the account email shown in User Accounts —
  // always keep user_accounts.email in sync with Auth in the same operation.
  if (target.persona === "staff") {
    const { error: staffEmailError } = await admin
      .from("user_accounts")
      .update({ email: newEmail })
      .eq("tenant_id", target.tenantId)
      .eq("auth_uid", target.recordId);
    if (staffEmailError) {
      return {
        ok: false,
        error: staffEmailError.message,
        status: 400,
        field: "email",
      };
    }
  } else if (options.alsoUpdateProfileEmail) {
    if (target.persona === "landlord") {
      await admin
        .from("tenants")
        .update({ email: newEmail })
        .eq("id", target.tenantId);
    } else if (target.persona === "lessee") {
      await admin
        .from("lessees")
        .update({ email: newEmail })
        .eq("tenant_id", target.tenantId)
        .eq("lessee_id", target.recordId);
    } else if (target.persona === "facility_manager") {
      await admin
        .from("facility_managers")
        .update({ email: newEmail })
        .eq("tenant_id", target.tenantId)
        .eq("facility_manager_id", target.recordId);
    }
  }

  await writePortalLoginAccessAudit(admin, {
    actorAuthUid: ctx.actorAuthUid,
    actorPersona: ctx.actorPersona,
    actorTenantId: ctx.actorTenantId,
    targetPersona: target.persona,
    targetRecordId: target.recordId,
    targetAuthUid: target.authUserId,
    action: "email_changed",
    oldEmail,
    newEmail,
    verificationMethod: options.verificationMethod,
    reason: options.reason,
  });

  let notificationFailed = false;
  if (oldEmail && oldEmail !== newEmail) {
    const notified = await notifyLoginEmailChanged({
      oldEmail,
      newEmail,
      actorPersona: ctx.actorPersona,
    });
    if (!notified.ok) {
      notificationFailed = true;
    }
  }

  return {
    ok: true,
    message: "Login email updated.",
    notificationFailed,
  };
}

export async function createPortalLogin(
  ctx: ActionContext,
  options: {
    ref: PortalLoginTargetRef;
    email: string;
    password: string;
    verificationMethod: PortalLoginVerificationMethod;
    reason: string;
  },
): Promise<{ ok: true; message: string; notificationFailed?: boolean } | ActionFailure> {
  const loaded = await loadAuthorizedTarget(ctx, options.ref);
  if (!loaded.ok) return loaded;
  const { admin, target } = loaded;

  const email = options.email.trim().toLowerCase();
  if (!isValidEmailFormat(email)) {
    return {
      ok: false,
      error: "Please enter a valid email address.",
      status: 400,
      field: "email",
    };
  }

  const lengthError = validatePasswordLength(options.password);
  if (lengthError) {
    return { ok: false, error: lengthError, status: 400, field: "password" };
  }

  if (target.authUserId) {
    const existing = await loadAuthUserSnapshot(admin, target.authUserId);
    if (existing.exists) {
      return {
        ok: false,
        error: "An Auth login already exists. Use Set temporary password or Change login email.",
        status: 400,
      };
    }
  }

  const emailOwner = await findAuthUserIdByEmailAcrossAllPages(admin, email);
  if (emailOwner) {
    return {
      ok: false,
      error:
        "This email is already used by another login on the platform. Use a different email or contact support.",
      status: 409,
      field: "email",
    };
  }

  const portalMeta =
    target.persona === "landlord"
      ? "landlord"
      : target.persona === "facility_manager"
        ? "facility_manager"
        : target.persona === "staff"
          ? "staff"
          : "lessee";

  const createPayload: {
    id?: string;
    email: string;
    password: string;
    email_confirm: boolean;
    user_metadata: { portal: string };
    app_metadata: Record<string, unknown>;
  } = {
    email,
    password: options.password,
    email_confirm: true,
    user_metadata: { portal: portalMeta },
    app_metadata: buildMustChangeAppMetadata({}),
  };
  if (target.authUserId) {
    createPayload.id = target.authUserId;
  }

  const { data: created, error: createError } =
    await admin.auth.admin.createUser(createPayload);

  if (createError || !created.user) {
    return {
      ok: false,
      error: mapSupabaseCreateUserError(createError, mapSupabasePasswordError),
      status: 400,
    };
  }

  const newAuthId = created.user.id;
  if (target.authUserId && newAuthId !== target.authUserId) {
    await admin.auth.admin.deleteUser(newAuthId).catch(() => undefined);
    return {
      ok: false,
      error: "Could not preserve the recorded Auth user id. Contact support.",
      status: 500,
    };
  }

  if (target.persona === "landlord") {
    await admin
      .from("landlords")
      .update({ auth_user_id: newAuthId })
      .eq("tenant_id", target.tenantId);
  } else if (target.persona === "lessee") {
    await admin
      .from("lessees")
      .update({ auth_user_id: newAuthId })
      .eq("tenant_id", target.tenantId)
      .eq("lessee_id", target.recordId);
  } else if (target.persona === "facility_manager") {
    const { data: fmRow } = await admin
      .from("facility_managers")
      .select("status")
      .eq("tenant_id", target.tenantId)
      .eq("facility_manager_id", target.recordId)
      .maybeSingle();
    const fmUpdate: Record<string, unknown> = { auth_user_id: newAuthId };
    if (fmRow?.status === "invited") {
      fmUpdate.status = "active";
      fmUpdate.activated_at = new Date().toISOString();
    }
    await admin
      .from("facility_managers")
      .update(fmUpdate)
      .eq("tenant_id", target.tenantId)
      .eq("facility_manager_id", target.recordId);
  } else if (target.persona === "staff") {
    await admin
      .from("user_accounts")
      .update({ email })
      .eq("tenant_id", target.tenantId)
      .eq("auth_uid", newAuthId);
  }

  await recordPasswordUpdatedAt(newAuthId);

  await writePortalLoginAccessAudit(admin, {
    actorAuthUid: ctx.actorAuthUid,
    actorPersona: ctx.actorPersona,
    actorTenantId: ctx.actorTenantId,
    targetPersona: target.persona,
    targetRecordId: target.recordId,
    targetAuthUid: newAuthId,
    action: "login_created",
    oldEmail: null,
    newEmail: email,
    verificationMethod: options.verificationMethod,
    reason: options.reason,
  });

  let notificationFailed = false;
  const notified = await notifyTemporaryPasswordSet({
    loginEmail: email,
    actorPersona: ctx.actorPersona,
    created: true,
  });
  if (!notified.ok) {
    notificationFailed = true;
  }

  return {
    ok: true,
    message: "Login created.",
    notificationFailed,
  };
}

export async function listFacilityManagersForLandlordLoginAccess(
  ctx: ActionContext,
  tenantId: string,
): Promise<
  | {
      ok: true;
      rows: Array<{
        facilityManagerId: string;
        fullName: string;
        email: string;
        authUserExists: boolean;
        loginEmail: string | null;
        lastSignInAt: string | null;
        isSuspended: boolean;
      }>;
    }
  | ActionFailure
> {
  if (ctx.actorPath !== "admin") {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  const loaded = await loadAuthorizedTarget(ctx, {
    persona: "landlord",
    tenantId,
  });
  if (!loaded.ok) return loaded;

  const { admin, target } = loaded;
  if (target.landlordType !== "davors_managed") {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  const { data: fms, error } = await admin
    .from("facility_managers")
    .select(
      "facility_manager_id, full_name, email, auth_user_id, status",
    )
    .eq("tenant_id", tenantId)
    .neq("status", "revoked")
    .order("full_name", { ascending: true });

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }

  const rows = [];
  for (const fm of fms ?? []) {
    const authUserId =
      typeof fm.auth_user_id === "string" && fm.auth_user_id.trim()
        ? fm.auth_user_id.trim()
        : null;
    const auth = await loadAuthUserSnapshot(admin, authUserId);
    rows.push({
      facilityManagerId: fm.facility_manager_id as string,
      fullName:
        typeof fm.full_name === "string" ? fm.full_name : "Facility manager",
      email: typeof fm.email === "string" ? fm.email : "",
      authUserExists: auth.exists,
      loginEmail: auth.exists ? auth.email : null,
      lastSignInAt: auth.exists ? auth.lastSignInAt : null,
      isSuspended: auth.exists ? auth.isSuspended : false,
    });
  }

  return { ok: true, rows };
}

export async function listTenantSuperAdminsForLoginAccess(
  ctx: ActionContext,
  tenantId: string,
): Promise<
  | {
      ok: true;
      rows: Array<{
        authUid: string;
        email: string;
        fullName: string;
        authUserExists: boolean;
        loginEmail: string | null;
        lastSignInAt: string | null;
        isSuspended: boolean;
      }>;
    }
  | ActionFailure
> {
  if (ctx.actorPath !== "admin") {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  const trimmed = tenantId.trim();
  if (!trimmed) {
    return { ok: false, error: "tenant_id is required", status: 400 };
  }

  const admin = createAdminClient();
  const { data: accounts, error } = await admin
    .from("user_accounts")
    .select("auth_uid, email, employee_id, is_active")
    .eq("tenant_id", trimmed)
    .eq("role", "super_admin")
    .order("email", { ascending: true });

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }

  const rows = [];
  for (const account of accounts ?? []) {
    const authUid = account.auth_uid as string;
    const auth = await loadAuthUserSnapshot(admin, authUid);
    let fullName =
      typeof account.email === "string" ? account.email : "Super admin";
    if (
      typeof account.employee_id === "string" &&
      account.employee_id.trim()
    ) {
      const { data: employee } = await admin
        .from("employees")
        .select("full_name")
        .eq("employee_id", account.employee_id)
        .maybeSingle();
      if (
        typeof employee?.full_name === "string" &&
        employee.full_name.trim()
      ) {
        fullName = employee.full_name.trim();
      }
    }
    rows.push({
      authUid,
      email: typeof account.email === "string" ? account.email : "",
      fullName,
      authUserExists: auth.exists,
      loginEmail: auth.exists ? auth.email : null,
      lastSignInAt: auth.exists ? auth.lastSignInAt : null,
      isSuspended: auth.exists ? auth.isSuspended : false,
    });
  }

  return { ok: true, rows };
}
