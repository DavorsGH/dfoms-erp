import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPortalInviteEmail } from "@/utils/portal-invite-email";
import { sendResendEmail } from "@/utils/resend-email";

export const LANDLORD_INVITE_EXPIRY_DAYS = 7;

export function hashLandlordInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateLandlordInviteRawToken(): string {
  return randomBytes(32).toString("hex");
}

function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://portal.davorsfacilities.com"
  );
}

/**
 * Creates a single-use invite for a landlord who does not yet have auth_user_id.
 * Contact email is tenants.email (landlords table has no email column).
 * Best-effort: returns skipped/failed without throwing so approve can succeed.
 */
export async function createAndSendLandlordPortalInvite(
  admin: SupabaseClient,
  args: {
    tenantId: string;
  },
): Promise<
  | { ok: true; status: "sent" }
  | { ok: true; status: "skipped"; reason: string }
  | { ok: false; error: string }
> {
  const [{ data: landlord, error: landlordError }, { data: tenant, error: tenantError }] =
    await Promise.all([
      admin
        .from("landlords")
        .select("tenant_id, auth_user_id, approval_status")
        .eq("tenant_id", args.tenantId)
        .maybeSingle(),
      admin
        .from("tenants")
        .select("id, name, email, product_line")
        .eq("id", args.tenantId)
        .eq("product_line", "real_estate_only")
        .maybeSingle(),
    ]);

  if (landlordError) {
    return { ok: false, error: landlordError.message };
  }
  if (tenantError) {
    return { ok: false, error: tenantError.message };
  }
  if (!landlord) {
    return { ok: false, error: "Landlord record not found for invite." };
  }
  if (!tenant) {
    return { ok: false, error: "Landlord tenant not found for invite." };
  }
  if (landlord.auth_user_id) {
    return {
      ok: true,
      status: "skipped",
      reason: "Landlord already has a portal account.",
    };
  }

  const email =
    typeof tenant.email === "string" ? tenant.email.trim().toLowerCase() : "";
  if (!email) {
    return {
      ok: true,
      status: "skipped",
      reason: "Landlord has no contact email (tenants.email).",
    };
  }

  const rawToken = generateLandlordInviteRawToken();
  const tokenHash = hashLandlordInviteToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + LANDLORD_INVITE_EXPIRY_DAYS);

  // Invalidate any outstanding unused invites for this landlord tenant.
  await admin
    .from("landlord_portal_invites")
    .update({ used_at: now.toISOString() })
    .eq("tenant_id", args.tenantId)
    .is("used_at", null);

  const { error: insertError } = await admin
    .from("landlord_portal_invites")
    .insert({
      tenant_id: args.tenantId,
      email,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      used_at: null,
      created_at: now.toISOString(),
    });

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  const inviteUrl = `${siteBaseUrl()}/landlord-portal/accept-invite?token=${encodeURIComponent(rawToken)}`;
  const displayName =
    typeof tenant.name === "string" && tenant.name.trim()
      ? tenant.name.trim()
      : "there";

  const content = buildPortalInviteEmail({
    portalName: "Davors Landlord Portal",
    inviteeDisplayName: displayName,
    inviterLine:
      "Your landlord account with Davors Facilities is approved. Use the link below to set a password and view your properties, leases, and rent collection status online.",
    inviteUrl,
    expiryDays: LANDLORD_INVITE_EXPIRY_DAYS,
    subject: "You're invited to the Davors Landlord Portal",
  });

  const emailResult = await sendResendEmail({
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  if (!emailResult.ok) {
    return { ok: false, error: emailResult.error };
  }

  return { ok: true, status: "sent" };
}
