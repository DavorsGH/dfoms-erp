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

function buildLesseeInviteEmailContent(args: {
  displayName: string;
  inviteUrl: string;
  existingAuthAccount: boolean;
}): { subject: string; html: string; text: string } {
  const { displayName, inviteUrl, existingAuthAccount } = args;
  const safeName = escapeHtml(displayName);

  if (existingAuthAccount) {
    return {
      subject: "New lease linked — Davors Tenant Portal",
      html: `
      <h2>Davors Tenant Portal</h2>
      <p>Hi ${safeName},</p>
      <p>Your landlord (managed by Davors Facilities) has invited you to view a lease on the Tenant Portal.</p>
      <p>You already have a portal account. <a href="${inviteUrl}">Accept this invite</a> to link the lease, then sign in with your existing password.</p>
      <p>${escapeHtml(REUSED_ACCOUNT_LOGIN_HINT)}</p>
      <p>This link expires in ${LESSEE_INVITE_EXPIRY_DAYS} days. If you did not expect this email, you can ignore it.</p>
    `,
      text: `Hi ${displayName},\n\nYour landlord has invited you to view a lease on the Davors Tenant Portal.\n\nYou already have an account. Accept this invite to link the lease, then sign in with your existing password:\n${inviteUrl}\n\n${REUSED_ACCOUNT_LOGIN_HINT}\n\nThis link expires in ${LESSEE_INVITE_EXPIRY_DAYS} days.`,
    };
  }

  return {
    subject: "You're invited to the Davors Tenant Portal",
    html: `
      <h2>Welcome to the Davors Tenant Portal</h2>
      <p>Hi ${safeName},</p>
      <p>Your landlord (managed by Davors Facilities) has invited you to view your lease and rent status online.</p>
      <p><a href="${inviteUrl}">Accept invite and set your password</a></p>
      <p>This link expires in ${LESSEE_INVITE_EXPIRY_DAYS} days. If you did not expect this email, you can ignore it.</p>
    `,
    text: `Hi ${displayName},\n\nAccept your Davors Tenant Portal invite and set a password:\n${inviteUrl}\n\nThis link expires in ${LESSEE_INVITE_EXPIRY_DAYS} days.`,
  };
}

/**
 * Creates a single-use invite for a lessee who does not yet have auth_user_id
 * on THIS landlord's lessee row, and always dispatches Resend when returning
 * status "sent".
 *
 * When Supabase Auth already has this email (sequential reuse after revoke at
 * another landlord), the invite email uses existing-account wording; Auth
 * linking still happens on accept — this function does not attach auth_user_id.
 *
 * Soft skips (ok + status "skipped") are only for lease-create best-effort
 * paths. Explicit invite APIs must treat skipped as non-success (409).
 */
export async function createAndSendLesseePortalInvite(
  admin: SupabaseClient,
  args: {
    tenantId: string;
    lesseeId: string;
  },
): Promise<
  | { ok: true; status: "sent"; existingAuthAccount: boolean; resendId: string }
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

  // Auth may still exist after a prior landlord revoked (auth_user_id cleared).
  // Invite send must still email; accept will link the existing Auth user.
  const existingAuthUserId = await findAuthUserIdByEmail(admin, email);
  const existingAuthAccount = Boolean(existingAuthUserId);

  const rawToken = generateLesseeInviteRawToken();
  const tokenHash = hashLesseeInviteToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + LESSEE_INVITE_EXPIRY_DAYS);

  // Invalidate any outstanding unused invites for this lessee (this tenant only).
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

  const content = buildLesseeInviteEmailContent({
    displayName,
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
    // Roll back so UI does not show Invited after a failed send.
    await admin
      .from("lessee_portal_invites")
      .delete()
      .eq("tenant_id", args.tenantId)
      .eq("lessee_id", args.lesseeId)
      .eq("token_hash", tokenHash);

    const detail =
      emailResult.error.trim() || "Email provider rejected the send.";
    return {
      ok: false,
      error: `Unable to send portal invite email: ${detail}`,
    };
  }

  // Fail-closed: Resend must return a message id (dispatch evidence).
  const resendId =
    typeof emailResult.id === "string" ? emailResult.id.trim() : "";
  if (!resendId) {
    await admin
      .from("lessee_portal_invites")
      .delete()
      .eq("tenant_id", args.tenantId)
      .eq("lessee_id", args.lesseeId)
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
