import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForEmail,
} from "@/lib/auth/cross-persona-guard";
import {
  findAuthUserIdByEmail,
  REUSED_ACCOUNT_LOGIN_HINT,
} from "@/utils/email-reuse";
import { buildPortalInviteEmail } from "@/utils/portal-invite-email";
import {
  isResendConfigured,
  resendNotConfiguredMessage,
  sendResendEmail,
} from "@/utils/resend-email";

export const FACILITY_MANAGER_INVITE_EXPIRY_DAYS = 7;

export type FacilityManagerCapabilityFlags = {
  can_manage_maintenance: boolean;
  can_manage_complaints: boolean;
  can_manage_inspections: boolean;
  can_log_services: boolean;
  can_collect_rent: boolean;
  can_collect_charges: boolean;
};

export const DEFAULT_FACILITY_MANAGER_CAPABILITIES: FacilityManagerCapabilityFlags =
  {
    can_manage_maintenance: true,
    can_manage_complaints: true,
    can_manage_inspections: true,
    can_log_services: true,
    can_collect_rent: false,
    can_collect_charges: false,
  };

export const DAVORS_MANAGED_FM_COLLECTION_CAPABILITY_ERROR =
  "Rent and charge collection cannot be enabled for facility managers on Davors-managed landlord accounts. Davors staff record payments on your behalf.";

/** Block collect-rent/charges for davors_managed landlords (no landlord confirm path). */
export function rejectDavorsManagedFacilityManagerCollectionCapabilities(args: {
  landlordType: string | null;
  canCollectRent: boolean;
  canCollectCharges: boolean;
}): string | null {
  if (args.landlordType !== "davors_managed") {
    return null;
  }
  if (args.canCollectRent || args.canCollectCharges) {
    return DAVORS_MANAGED_FM_COLLECTION_CAPABILITY_ERROR;
  }
  return null;
}

export function hashFacilityManagerInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateFacilityManagerInviteRawToken(): string {
  return randomBytes(32).toString("hex");
}

function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://portal.davorsfacilities.com"
  );
}

function buildFacilityManagerInviteEmailContent(args: {
  displayName: string;
  landlordName: string;
  inviteUrl: string;
  existingAuthAccount: boolean;
}): { subject: string; html: string; text: string } {
  const { displayName, landlordName, inviteUrl, existingAuthAccount } = args;

  return buildPortalInviteEmail({
    portalName: "Facility Manager Portal",
    inviteeDisplayName: displayName,
    inviterLine: `${landlordName} has invited you to manage properties on Davors Facilities.`,
    inviteUrl,
    expiryDays: FACILITY_MANAGER_INVITE_EXPIRY_DAYS,
    subject: "You're invited as a Facility Manager — Davors Facilities",
    existingAuthAccount,
    reuseSubject: "Facility Manager access — Davors Facilities",
    reuseHeading: "Davors Facility Manager Portal",
    reuseInviterLine: `${landlordName} has invited you to manage properties on the Facility Manager Portal.`,
    reuseLinkPurpose: "link your Facility Manager access",
    reuseHint: REUSED_ACCOUNT_LOGIN_HINT,
  });
}

/**
 * Issue (or re-issue) a hashed invite token and email it.
 * Caller must ensure the facility_managers row exists and is status=invited
 * without auth_user_id.
 */
export async function createAndSendFacilityManagerPortalInvite(
  admin: SupabaseClient,
  args: {
    tenantId: string;
    facilityManagerId: string;
    landlordName?: string;
  },
): Promise<
  | { ok: true; status: "sent"; existingAuthAccount: boolean; resendId: string }
  | { ok: true; status: "skipped"; reason: string }
  | { ok: false; error: string }
> {
  const { data: fm, error: fmError } = await admin
    .from("facility_managers")
    .select(
      "facility_manager_id, auth_user_id, full_name, email, status, tenant_id",
    )
    .eq("tenant_id", args.tenantId)
    .eq("facility_manager_id", args.facilityManagerId)
    .maybeSingle();

  if (fmError) {
    return { ok: false, error: fmError.message };
  }
  if (!fm) {
    return { ok: false, error: "Facility manager not found for invite." };
  }
  if (fm.auth_user_id) {
    return {
      ok: true,
      status: "skipped",
      reason: "Facility manager already has a portal account.",
    };
  }
  if (fm.status === "revoked") {
    return {
      ok: false,
      error: "Cannot invite a revoked facility manager. Create a new invite.",
    };
  }
  if (fm.status !== "invited" && fm.status !== "active") {
    return { ok: false, error: "Facility manager is not eligible for invite." };
  }

  const email =
    typeof fm.email === "string" ? fm.email.trim().toLowerCase() : "";
  if (!email) {
    return {
      ok: true,
      status: "skipped",
      reason: "Facility manager has no email address.",
    };
  }

  const crossPersona = await findCrossPersonaConflictForEmail(admin, email, {
    targetPersona: "facility_manager",
    excludeFacilityManagerId: args.facilityManagerId,
  });
  if (crossPersona) {
    return { ok: false, error: crossPersonaErrorMessage(crossPersona) };
  }

  if (!isResendConfigured()) {
    return { ok: false, error: resendNotConfiguredMessage() };
  }

  let landlordName = args.landlordName?.trim() ?? "";
  if (!landlordName) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("name")
      .eq("id", args.tenantId)
      .maybeSingle();
    landlordName =
      typeof tenant?.name === "string" && tenant.name.trim()
        ? tenant.name.trim()
        : "Your landlord";
  }

  const existingAuthUserId = await findAuthUserIdByEmail(admin, email);
  const existingAuthAccount = Boolean(existingAuthUserId);

  const rawToken = generateFacilityManagerInviteRawToken();
  const tokenHash = hashFacilityManagerInviteToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + FACILITY_MANAGER_INVITE_EXPIRY_DAYS);

  await admin
    .from("facility_manager_portal_invites")
    .update({ used_at: now.toISOString() })
    .eq("tenant_id", args.tenantId)
    .eq("facility_manager_id", args.facilityManagerId)
    .is("used_at", null);

  const { error: insertError } = await admin
    .from("facility_manager_portal_invites")
    .insert({
      tenant_id: args.tenantId,
      facility_manager_id: args.facilityManagerId,
      email,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      used_at: null,
      created_at: now.toISOString(),
    });

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  const inviteUrl = `${siteBaseUrl()}/facility-portal/accept-invite?token=${encodeURIComponent(rawToken)}`;
  const displayName =
    typeof fm.full_name === "string" && fm.full_name.trim()
      ? fm.full_name.trim()
      : "there";

  const content = buildFacilityManagerInviteEmailContent({
    displayName,
    landlordName,
    inviteUrl,
    existingAuthAccount,
  });

  const emailResult = await sendResendEmail({
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  if (!emailResult.ok) {
    await admin
      .from("facility_manager_portal_invites")
      .delete()
      .eq("tenant_id", args.tenantId)
      .eq("facility_manager_id", args.facilityManagerId)
      .eq("token_hash", tokenHash);

    const detail =
      emailResult.error.trim() || "Email provider rejected the send.";
    return {
      ok: false,
      error: `Unable to send portal invite email: ${detail}`,
    };
  }

  const resendId =
    typeof emailResult.id === "string" ? emailResult.id.trim() : "";
  if (!resendId) {
    await admin
      .from("facility_manager_portal_invites")
      .delete()
      .eq("tenant_id", args.tenantId)
      .eq("facility_manager_id", args.facilityManagerId)
      .eq("token_hash", tokenHash);

    return {
      ok: false,
      error:
        "Unable to send portal invite email: provider accepted the request but returned no message id.",
    };
  }

  return {
    ok: true,
    status: "sent",
    existingAuthAccount,
    resendId,
  };
}

export async function fetchPendingFacilityManagerInviteExpiresAt(
  admin: SupabaseClient,
  args: { tenantId: string; facilityManagerId: string },
): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("facility_manager_portal_invites")
    .select("expires_at")
    .eq("tenant_id", args.tenantId)
    .eq("facility_manager_id", args.facilityManagerId)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return typeof data?.expires_at === "string" ? data.expires_at : null;
}

/**
 * Ensure every property_id belongs to the landlord tenant (cross-tenant invariant).
 */
export async function assertPropertiesBelongToTenant(
  admin: SupabaseClient,
  args: { tenantId: string; propertyIds: string[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const unique = [...new Set(args.propertyIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { ok: false, error: "At least one property must be assigned." };
  }

  const { data: rows, error } = await admin
    .from("properties")
    .select("property_id")
    .eq("tenant_id", args.tenantId)
    .in("property_id", unique);

  if (error) {
    return { ok: false, error: error.message };
  }

  const found = new Set((rows ?? []).map((r) => r.property_id as string));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        "One or more selected properties do not belong to this landlord tenant.",
    };
  }

  return { ok: true };
}
