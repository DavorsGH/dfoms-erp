import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluatePostPasswordMfa } from "@/lib/mfa/post-login";
import { MFA_CHALLENGE_ROUTES } from "@/lib/mfa/types";
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForAuthUid,
  findCrossPersonaConflictForEmail,
} from "@/lib/auth/cross-persona-guard";
import {
  acceptFacilityManagerInviteWithOAuth,
  acceptLandlordInviteWithOAuth,
  acceptLesseeInviteWithOAuth,
  acceptStaffInviteWithOAuth,
} from "@/lib/auth/oauth-invite-accept";
import {
  confirmAuthUserEmailIfNeeded,
  findAnyPersonaByAuthUid,
  findPersonaByAuthUid,
  normalizeOAuthEmail,
} from "@/lib/auth/oauth-persona-resolve";
import {
  defaultDashboardForPersona,
  type OAuthFlowPayload,
} from "@/lib/auth/oauth-types";
import { syncAuthUserPortalMetadata } from "@/lib/auth/portal-metadata";
import { approveLandlordTenant } from "@/utils/landlord-approval";
import {
  createPendingLandlordTenant,
  rollbackPendingLandlordTenant,
  validatePendingLandlordInput,
} from "@/utils/landlord-create";
import { sendLandlordSelfSignupWelcomeEmail } from "@/utils/landlord-signup-emails";
import { notifyStaffLandlordSelfSignupApproved } from "@/utils/real-estate-staff-notifications";
import { getSafeNext } from "@/utils/safe-redirect";
import { provisionStaffTenantSignup } from "@/utils/staff-tenant-signup";
import { validateStaffOAuthSignupFields } from "@/utils/tenant-signup";
import { recordPasswordUpdatedAt } from "@/lib/security/password-updated-at";
import {
  logAuthActivity,
  resolveAuthActivityTenantId,
} from "@/lib/user-activity-log";
import type { UserActivityPersona } from "@/utils/user-activity-log-types";

type AdminClient = SupabaseClient;

export type OAuthDispatchOptions = {
  ip?: string | null;
};

async function logOAuthFailure(
  persona: UserActivityPersona,
  options: {
    email?: string | null;
    authUserId?: string | null;
    tenantId?: string | null;
    ip?: string | null;
    failureReason: string;
  },
): Promise<void> {
  logAuthActivity({
    persona,
    eventName: "login.oauth_failure",
    status: "failure",
    email: options.email,
    ip: options.ip,
    tenantId: options.tenantId,
    authUserId: options.authUserId,
    method: "oauth",
    failureReason: options.failureReason,
  });
}

async function logOAuthSuccess(
  persona: UserActivityPersona,
  authUserId: string,
  email: string,
  ip?: string | null,
): Promise<void> {
  const tenantId = await resolveAuthActivityTenantId({ persona, authUserId });
  logAuthActivity({
    persona,
    eventName: "login.oauth_success",
    status: "success",
    email,
    ip,
    tenantId,
    authUserId,
    method: "oauth",
  });
}

async function resolvePostOAuthRedirect(
  authUid: string,
  persona: OAuthFlowPayload["persona"],
  destination: string,
): Promise<{ redirectTo: string; mfaRequired: boolean }> {
  const mfa = await evaluatePostPasswordMfa(authUid);
  if (!mfa.mfaRequired) {
    return { redirectTo: destination, mfaRequired: false };
  }

  const routes = MFA_CHALLENGE_ROUTES[persona];
  const params = new URLSearchParams();
  params.set("next", destination);
  params.set("method", mfa.method);
  return {
    redirectTo: `${routes.challengePath}?${params.toString()}`,
    mfaRequired: true,
  };
}

export type OAuthDispatchResult =
  | {
      ok: true;
      redirectTo: string;
    }
  | {
      ok: false;
      error: string;
      persona: OAuthFlowPayload["persona"];
    };

async function handleLoginFlow(
  admin: AdminClient,
  authUid: string,
  oauthEmail: string,
  flow: OAuthFlowPayload,
  options?: OAuthDispatchOptions,
): Promise<OAuthDispatchResult> {
  const personaRow = await findPersonaByAuthUid(admin, authUid, flow.persona);
  if (!personaRow) {
    await logOAuthFailure(flow.persona, {
      email: oauthEmail,
      authUserId: authUid,
      ip: options?.ip,
      failureReason: "persona_not_linked",
    });
    return {
      ok: false,
      error: `No ${flow.persona} account is linked to this sign-in. Contact your administrator or use the correct portal.`,
      persona: flow.persona,
    };
  }

  await confirmAuthUserEmailIfNeeded(admin, authUid);
  await syncAuthUserPortalMetadata(authUid, flow.persona);

  const destination = getSafeNext(
    flow.next,
    defaultDashboardForPersona(flow.persona),
  );
  return finishOAuthRedirect(
    authUid,
    flow.persona,
    oauthEmail,
    destination,
    options,
  );
}

async function finishOAuthRedirect(
  authUid: string,
  persona: UserActivityPersona,
  oauthEmail: string,
  destination: string,
  options?: OAuthDispatchOptions,
): Promise<OAuthDispatchResult> {
  const { redirectTo, mfaRequired } = await resolvePostOAuthRedirect(
    authUid,
    persona,
    destination,
  );
  if (!mfaRequired) {
    await logOAuthSuccess(persona, authUid, oauthEmail, options?.ip);
  }
  return { ok: true, redirectTo };
}

async function handleOpenSignupFlow(
  admin: AdminClient,
  authUid: string,
  oauthEmail: string,
  flow: OAuthFlowPayload,
  options?: OAuthDispatchOptions,
): Promise<OAuthDispatchResult> {
  const existing = await findAnyPersonaByAuthUid(admin, authUid);
  if (existing) {
    if (existing.persona === flow.persona) {
      await confirmAuthUserEmailIfNeeded(admin, authUid);
      await syncAuthUserPortalMetadata(authUid, existing.persona);
      const destination = getSafeNext(
        flow.next,
        defaultDashboardForPersona(existing.persona),
      );
      return finishOAuthRedirect(
        authUid,
        existing.persona,
        oauthEmail,
        destination,
        options,
      );
    }

    const crossByAuth = await findCrossPersonaConflictForAuthUid(admin, authUid, {
      targetPersona: flow.persona,
    });
    await logOAuthFailure(flow.persona, {
      email: oauthEmail,
      authUserId: authUid,
      ip: options?.ip,
      failureReason:
        crossByAuth?.detail ??
        "This sign-in is already linked to another portal account.",
    });
    return {
      ok: false,
      error:
        crossByAuth?.detail ??
        "This sign-in is already linked to another portal account.",
      persona: flow.persona,
    };
  }

  const crossByAuth = await findCrossPersonaConflictForAuthUid(admin, authUid, {
    targetPersona: flow.persona,
  });
  if (crossByAuth) {
    await logOAuthFailure(flow.persona, {
      email: oauthEmail,
      authUserId: authUid,
      ip: options?.ip,
      failureReason: crossPersonaErrorMessage(crossByAuth),
    });
    return {
      ok: false,
      error: crossPersonaErrorMessage(crossByAuth),
      persona: flow.persona,
    };
  }

  if (flow.persona === "staff") {
    const validation = validateStaffOAuthSignupFields({
      company_name: flow.signup?.company_name,
      admin_full_name: flow.signup?.admin_full_name,
      admin_email: flow.signup?.admin_email ?? oauthEmail,
    });
    if (!validation.ok) {
      await logOAuthFailure(flow.persona, {
        email: oauthEmail,
        authUserId: authUid,
        ip: options?.ip,
        failureReason: validation.error,
      });
      return { ok: false, error: validation.error, persona: flow.persona };
    }

    const { companyName, adminFullName, adminEmail } = validation.data;
    if (normalizeOAuthEmail(adminEmail) !== oauthEmail) {
      await logOAuthFailure(flow.persona, {
        email: oauthEmail,
        authUserId: authUid,
        ip: options?.ip,
        failureReason: "email_mismatch",
      });
      return {
        ok: false,
        error: `Sign up with the email you entered (${adminEmail}). You signed in as ${oauthEmail}.`,
        persona: flow.persona,
      };
    }

    await confirmAuthUserEmailIfNeeded(admin, authUid);
    await admin.auth.admin.updateUserById(authUid, {
      user_metadata: {
        full_name: adminFullName,
        company_name: companyName,
        portal: "staff",
      },
    });

    const provisioned = await provisionStaffTenantSignup(admin, {
      authUserId: authUid,
      companyName,
      adminFullName,
      adminEmail,
    });

    if (!provisioned.ok) {
      await logOAuthFailure(flow.persona, {
        email: oauthEmail,
        authUserId: authUid,
        ip: options?.ip,
        failureReason: provisioned.error,
      });
      return {
        ok: false,
        error: provisioned.error,
        persona: flow.persona,
      };
    }

    const destination = getSafeNext(flow.next, "/dashboard");
    return finishOAuthRedirect(
      authUid,
      "staff",
      oauthEmail,
      destination,
      options,
    );
  }

  if (flow.persona === "landlord") {
    const validation = validatePendingLandlordInput({
      name: flow.signup?.name,
      email: flow.signup?.email ?? oauthEmail,
      phone: flow.signup?.phone,
      address: flow.signup?.address,
    });
    if (!validation.ok) {
      await logOAuthFailure(flow.persona, {
        email: oauthEmail,
        authUserId: authUid,
        ip: options?.ip,
        failureReason: validation.error,
      });
      return { ok: false, error: validation.error, persona: flow.persona };
    }

    const { name, email, phone, address } = validation.data;
    if (normalizeOAuthEmail(email) !== oauthEmail) {
      await logOAuthFailure(flow.persona, {
        email: oauthEmail,
        authUserId: authUid,
        ip: options?.ip,
        failureReason: "email_mismatch",
      });
      return {
        ok: false,
        error: `Sign up with the email you entered (${email}). You signed in as ${oauthEmail}.`,
        persona: flow.persona,
      };
    }

    const crossByEmail = await findCrossPersonaConflictForEmail(admin, email, {
      targetPersona: "landlord",
    });
    if (crossByEmail) {
      await logOAuthFailure(flow.persona, {
        email: oauthEmail,
        authUserId: authUid,
        ip: options?.ip,
        failureReason: crossPersonaErrorMessage(crossByEmail),
      });
      return {
        ok: false,
        error: crossPersonaErrorMessage(crossByEmail),
        persona: flow.persona,
      };
    }

    const created = await createPendingLandlordTenant(admin, {
      name,
      email,
      phone,
      address,
    });
    if (!created.ok) {
      await logOAuthFailure(flow.persona, {
        email: oauthEmail,
        authUserId: authUid,
        ip: options?.ip,
        failureReason: created.error,
      });
      return {
        ok: false,
        error: created.error,
        persona: flow.persona,
        ...(created.status ? {} : {}),
      };
    }

    const tenantId = created.tenantId;
    const nowIso = new Date().toISOString();

    await confirmAuthUserEmailIfNeeded(admin, authUid);
    await recordPasswordUpdatedAt(authUid);
    await admin.auth.admin.updateUserById(authUid, {
      user_metadata: {
        full_name: name,
        portal: "landlord",
      },
    });

    const { error: linkError } = await admin
      .from("landlords")
      .update({ auth_user_id: authUid, updated_at: nowIso })
      .eq("tenant_id", tenantId)
      .is("auth_user_id", null);

    if (linkError) {
      await rollbackPendingLandlordTenant(admin, tenantId);
      await logOAuthFailure(flow.persona, {
        email: oauthEmail,
        authUserId: authUid,
        tenantId,
        ip: options?.ip,
        failureReason: linkError.message,
      });
      return { ok: false, error: linkError.message, persona: flow.persona };
    }

    const approval = await approveLandlordTenant(admin, tenantId);
    if (!approval.ok) {
      await admin.from("landlords").update({ auth_user_id: null }).eq("tenant_id", tenantId);
      await rollbackPendingLandlordTenant(admin, tenantId);
      await logOAuthFailure(flow.persona, {
        email: oauthEmail,
        authUserId: authUid,
        tenantId,
        ip: options?.ip,
        failureReason: approval.error,
      });
      return { ok: false, error: approval.error, persona: flow.persona };
    }

    if (approval.transitioned) {
      void sendLandlordSelfSignupWelcomeEmail({ email, name });
      void notifyStaffLandlordSelfSignupApproved({
        landlordTenantId: tenantId,
        landlordType: "platform_only",
        landlordName: name,
      });
    }

    await syncAuthUserPortalMetadata(authUid, "landlord");

    const destination = getSafeNext(
      flow.next,
      "/landlord-portal/dashboard",
    );
    return finishOAuthRedirect(
      authUid,
      "landlord",
      oauthEmail,
      destination,
      options,
    );
  }

  await logOAuthFailure(flow.persona, {
    email: oauthEmail,
    authUserId: authUid,
    ip: options?.ip,
    failureReason: "open_signup_unavailable",
  });
  return {
    ok: false,
    error: "Open signup is not available for this portal.",
    persona: flow.persona,
  };
}

async function handleAcceptInviteFlow(
  admin: AdminClient,
  authUid: string,
  oauthEmail: string,
  flow: OAuthFlowPayload,
  options?: OAuthDispatchOptions,
): Promise<OAuthDispatchResult> {
  const rawToken = flow.invite_token?.trim() ?? "";
  if (!rawToken) {
    await logOAuthFailure(flow.persona, {
      email: oauthEmail,
      authUserId: authUid,
      ip: options?.ip,
      failureReason: "missing_invite_token",
    });
    return {
      ok: false,
      error: "Invite token is missing. Open the invite link again and retry.",
      persona: flow.persona,
    };
  }

  await confirmAuthUserEmailIfNeeded(admin, authUid);

  let acceptResult: { ok: true } | { ok: false; error: string; status: number };
  switch (flow.persona) {
    case "staff":
      acceptResult = await acceptStaffInviteWithOAuth(
        admin,
        authUid,
        oauthEmail,
        rawToken,
      );
      break;
    case "lessee":
      acceptResult = await acceptLesseeInviteWithOAuth(
        admin,
        authUid,
        oauthEmail,
        rawToken,
      );
      break;
    case "landlord":
      acceptResult = await acceptLandlordInviteWithOAuth(
        admin,
        authUid,
        oauthEmail,
        rawToken,
      );
      break;
    case "facility_manager":
      acceptResult = await acceptFacilityManagerInviteWithOAuth(
        admin,
        authUid,
        oauthEmail,
        rawToken,
      );
      break;
  }

  if (!acceptResult.ok) {
    await logOAuthFailure(flow.persona, {
      email: oauthEmail,
      authUserId: authUid,
      ip: options?.ip,
      failureReason: acceptResult.error,
    });
    return {
      ok: false,
      error: acceptResult.error,
      persona: flow.persona,
    };
  }

  const destination = getSafeNext(
    flow.next,
    defaultDashboardForPersona(flow.persona),
  );
  return finishOAuthRedirect(
    authUid,
    flow.persona,
    oauthEmail,
    destination,
    options,
  );
}

export async function dispatchOAuthCallback(
  admin: AdminClient,
  authUid: string,
  oauthEmail: string,
  flow: OAuthFlowPayload,
  options?: OAuthDispatchOptions,
): Promise<OAuthDispatchResult> {
  switch (flow.flow) {
    case "login":
      return handleLoginFlow(admin, authUid, oauthEmail, flow, options);
    case "open_signup":
      return handleOpenSignupFlow(admin, authUid, oauthEmail, flow, options);
    case "accept_invite":
      return handleAcceptInviteFlow(admin, authUid, oauthEmail, flow, options);
    default:
      await logOAuthFailure(flow.persona, {
        email: oauthEmail,
        authUserId: authUid,
        ip: options?.ip,
        failureReason: "unsupported_oauth_flow",
      });
      return {
        ok: false,
        error: "Unsupported OAuth flow.",
        persona: flow.persona,
      };
  }
}
