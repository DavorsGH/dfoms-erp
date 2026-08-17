import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluatePostPasswordMfa } from "@/lib/mfa/post-login";
import { MFA_CHALLENGE_ROUTES } from "@/lib/mfa/types";
import {
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

type AdminClient = SupabaseClient;

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

async function mfaRedirectIfNeeded(
  authUid: string,
  persona: OAuthFlowPayload["persona"],
  destination: string,
): Promise<string> {
  const mfa = await evaluatePostPasswordMfa(authUid);
  if (!mfa.mfaRequired) {
    return destination;
  }

  const routes = MFA_CHALLENGE_ROUTES[persona];
  const params = new URLSearchParams();
  params.set("next", destination);
  params.set("method", mfa.method);
  return `${routes.challengePath}?${params.toString()}`;
}

async function handleLoginFlow(
  admin: AdminClient,
  authUid: string,
  oauthEmail: string,
  flow: OAuthFlowPayload,
): Promise<OAuthDispatchResult> {
  const personaRow = await findPersonaByAuthUid(admin, authUid, flow.persona);
  if (!personaRow) {
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
  const redirectTo = await mfaRedirectIfNeeded(authUid, flow.persona, destination);
  return { ok: true, redirectTo };
}

async function handleOpenSignupFlow(
  admin: AdminClient,
  authUid: string,
  oauthEmail: string,
  flow: OAuthFlowPayload,
): Promise<OAuthDispatchResult> {
  const existing = await findAnyPersonaByAuthUid(admin, authUid);
  if (existing) {
    await confirmAuthUserEmailIfNeeded(admin, authUid);
    await syncAuthUserPortalMetadata(authUid, existing.persona);
    const destination = getSafeNext(
      flow.next,
      defaultDashboardForPersona(existing.persona),
    );
    const redirectTo = await mfaRedirectIfNeeded(
      authUid,
      existing.persona,
      destination,
    );
    return { ok: true, redirectTo };
  }

  if (flow.persona === "staff") {
    const validation = validateStaffOAuthSignupFields({
      company_name: flow.signup?.company_name,
      admin_full_name: flow.signup?.admin_full_name,
      admin_email: flow.signup?.admin_email ?? oauthEmail,
    });
    if (!validation.ok) {
      return { ok: false, error: validation.error, persona: flow.persona };
    }

    const { companyName, adminFullName, adminEmail } = validation.data;
    if (normalizeOAuthEmail(adminEmail) !== oauthEmail) {
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
      return {
        ok: false,
        error: provisioned.error,
        persona: flow.persona,
      };
    }

    const destination = getSafeNext(flow.next, "/dashboard");
    const redirectTo = await mfaRedirectIfNeeded(authUid, "staff", destination);
    return { ok: true, redirectTo };
  }

  if (flow.persona === "landlord") {
    const validation = validatePendingLandlordInput({
      name: flow.signup?.name,
      email: flow.signup?.email ?? oauthEmail,
      phone: flow.signup?.phone,
      address: flow.signup?.address,
    });
    if (!validation.ok) {
      return { ok: false, error: validation.error, persona: flow.persona };
    }

    const { name, email, phone, address } = validation.data;
    if (normalizeOAuthEmail(email) !== oauthEmail) {
      return {
        ok: false,
        error: `Sign up with the email you entered (${email}). You signed in as ${oauthEmail}.`,
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
      return { ok: false, error: linkError.message, persona: flow.persona };
    }

    const approval = await approveLandlordTenant(admin, tenantId);
    if (!approval.ok) {
      await admin.from("landlords").update({ auth_user_id: null }).eq("tenant_id", tenantId);
      await rollbackPendingLandlordTenant(admin, tenantId);
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
    const redirectTo = await mfaRedirectIfNeeded(authUid, "landlord", destination);
    return { ok: true, redirectTo };
  }

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
): Promise<OAuthDispatchResult> {
  const rawToken = flow.invite_token?.trim() ?? "";
  if (!rawToken) {
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
  }

  if (!acceptResult.ok) {
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
  const redirectTo = await mfaRedirectIfNeeded(authUid, flow.persona, destination);
  return { ok: true, redirectTo };
}

export async function dispatchOAuthCallback(
  admin: AdminClient,
  authUid: string,
  oauthEmail: string,
  flow: OAuthFlowPayload,
): Promise<OAuthDispatchResult> {
  switch (flow.flow) {
    case "login":
      return handleLoginFlow(admin, authUid, oauthEmail, flow);
    case "open_signup":
      return handleOpenSignupFlow(admin, authUid, oauthEmail, flow);
    case "accept_invite":
      return handleAcceptInviteFlow(admin, authUid, oauthEmail, flow);
    default:
      return {
        ok: false,
        error: "Unsupported OAuth flow.",
        persona: flow.persona,
      };
  }
}
