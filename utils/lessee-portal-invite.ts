import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForEmail,
} from "@/lib/auth/cross-persona-guard";
import {
  isResendConfigured,
  resendNotConfiguredMessage,
  sendResendEmail,
} from "@/utils/resend-email";

export const LESSEE_INVITE_EXPIRY_DAYS = 7;

export function hashLesseeInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateLesseeInviteRawToken(): string {
  return randomBytes(32).toString("hex");
}

function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://portal.davorsfacilities.com"
  );
}

/**
 * Creates a single-use invite for a lessee who does not yet have auth_user_id.
 * Best-effort: returns skipped/failed without throwing so lease creation can succeed.
 */
export async function createAndSendLesseePortalInvite(
  admin: SupabaseClient,
  args: {
    tenantId: string;
    lesseeId: string;
  },
): Promise<
  | { ok: true; status: "sent" }
  | { ok: true; status: "skipped"; reason: string }
  | { ok: false; error: string }
> {
  const { data: lessee, error: lesseeError } = await admin
    .from("lessees")
    .select("lessee_id, auth_user_id, full_name, email, status")
    .eq("tenant_id", args.tenantId)
    .eq("lessee_id", args.lesseeId)
    .maybeSingle();

  if (lesseeError) {
    return { ok: false, error: lesseeError.message };
  }
  if (!lessee) {
    return { ok: false, error: "Lessee not found for invite." };
  }
  if (lessee.auth_user_id) {
    return {
      ok: true,
      status: "skipped",
      reason: "Lessee already has a portal account.",
    };
  }

  const email =
    typeof lessee.email === "string" ? lessee.email.trim().toLowerCase() : "";
  if (!email) {
    return {
      ok: true,
      status: "skipped",
      reason: "Lessee has no email address.",
    };
  }

  const crossPersona = await findCrossPersonaConflictForEmail(admin, email, {
    targetPersona: "lessee",
    excludeLesseeId: args.lesseeId,
  });
  if (crossPersona) {
    return { ok: false, error: crossPersonaErrorMessage(crossPersona) };
  }

  // Fail before writing an invite row when email cannot be sent.
  if (!isResendConfigured()) {
    return { ok: false, error: resendNotConfiguredMessage() };
  }

  const rawToken = generateLesseeInviteRawToken();
  const tokenHash = hashLesseeInviteToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + LESSEE_INVITE_EXPIRY_DAYS);

  // Invalidate any outstanding unused invites for this lessee.
  await admin
    .from("lessee_portal_invites")
    .update({ used_at: now.toISOString() })
    .eq("tenant_id", args.tenantId)
    .eq("lessee_id", args.lesseeId)
    .is("used_at", null);

  const { error: insertError } = await admin.from("lessee_portal_invites").insert({
    tenant_id: args.tenantId,
    lessee_id: args.lesseeId,
    email,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    used_at: null,
    created_at: now.toISOString(),
  });

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  const inviteUrl = `${siteBaseUrl()}/portal/accept-invite?token=${encodeURIComponent(rawToken)}`;
  const displayName =
    typeof lessee.full_name === "string" && lessee.full_name.trim()
      ? lessee.full_name.trim()
      : "there";

  const emailResult = await sendResendEmail({
    to: email,
    subject: "You're invited to the Davors Tenant Portal",
    html: `
      <h2>Welcome to the Davors Tenant Portal</h2>
      <p>Hi ${escapeHtml(displayName)},</p>
      <p>Your landlord (managed by Davors Facilities) has invited you to view your lease and rent status online.</p>
      <p><a href="${inviteUrl}">Accept invite and set your password</a></p>
      <p>This link expires in ${LESSEE_INVITE_EXPIRY_DAYS} days. If you did not expect this email, you can ignore it.</p>
    `,
    text: `Hi ${displayName},\n\nAccept your Davors Tenant Portal invite and set a password:\n${inviteUrl}\n\nThis link expires in ${LESSEE_INVITE_EXPIRY_DAYS} days.`,
  });

  if (!emailResult.ok) {
    // Roll back so UI does not show Invited after a failed send.
    await admin
      .from("lessee_portal_invites")
      .delete()
      .eq("tenant_id", args.tenantId)
      .eq("lessee_id", args.lesseeId)
      .eq("token_hash", tokenHash);

    const detail = emailResult.error.trim() || "Email provider rejected the send.";
    return {
      ok: false,
      error: `Unable to send portal invite email: ${detail}`,
    };
  }

  return { ok: true, status: "sent" };
}

/**
 * Latest unused, unexpired invite expiry for a lessee (if any).
 */
export async function fetchPendingLesseeInviteExpiresAt(
  admin: SupabaseClient,
  args: { tenantId: string; lesseeId: string },
): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("lessee_portal_invites")
    .select("expires_at")
    .eq("tenant_id", args.tenantId)
    .eq("lessee_id", args.lesseeId)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return typeof data?.expires_at === "string" ? data.expires_at : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
