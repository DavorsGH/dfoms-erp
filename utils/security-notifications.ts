import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import { needsPasswordUpdateNudge } from "@/lib/security/password-updated-at";
import { insertLesseePortalNotification } from "@/utils/lessee-portal-notifications";
import { insertLandlordPortalNotification } from "@/utils/landlord-portal-notifications";

export const SECURITY_NOTIFICATION = {
  passwordTitle: "Update your password",
  passwordBody:
    "Your password was set before our updated security requirements. Choose a new password with at least 12 characters.",
  mfaTitle: "Activate two-factor authentication",
  mfaBody:
    "Protect your account by enabling two-factor authentication with an authenticator app or SMS.",
} as const;

export type SecurityPersona = "staff" | "lessee" | "landlord";

type EnsureOptions = {
  authUid: string;
  persona: SecurityPersona;
  tenantId: string;
  lesseeId?: string;
  passwordActionUrl: string;
  mfaActionUrl: string;
};

async function hasUnreadSecurityNotification(
  table: "employee_notifications" | "lessee_notifications" | "landlord_notifications",
  recipientUserId: string,
  title: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(table)
    .select("id")
    .eq("recipient_user_id", recipientUserId)
    .eq("title", title)
    .is("read_at", null)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      `[security-notifications] unread check failed (${table}):`,
      error.message,
    );
    return true;
  }

  return Boolean(data);
}

async function isMfaEnrolled(authUid: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_mfa_settings")
    .select("method, totp_enrolled_at, sms_phone_verified_at")
    .eq("auth_uid", authUid)
    .maybeSingle();

  if (error) {
    console.error("[security-notifications] MFA settings read failed:", error.message);
    return false;
  }

  if (!data) {
    return false;
  }

  const method = data.method ?? "none";
  if (method !== "none") {
    return true;
  }

  if (data.totp_enrolled_at?.trim()) {
    return true;
  }

  if (data.sms_phone_verified_at?.trim()) {
    return true;
  }

  return false;
}

async function needsMfaEnrollmentNudge(authUid: string): Promise<boolean> {
  return !(await isMfaEnrolled(authUid));
}

async function ensureStaffNotification(options: {
  authUid: string;
  tenantId: string;
  title: string;
  body: string;
  actionUrl: string;
}): Promise<void> {
  const already = await hasUnreadSecurityNotification(
    "employee_notifications",
    options.authUid,
    options.title,
  );
  if (already) return;

  const admin = createAdminClient();
  const { error } = await admin.from("employee_notifications").insert({
    tenant_id: options.tenantId,
    recipient_user_id: options.authUid,
    announcement_id: null,
    title: options.title,
    body: options.body,
    action_url: options.actionUrl,
  });

  if (error) {
    console.error("[security-notifications] staff insert failed:", error.message);
  }
}

/**
 * Best-effort security nudges into each persona's existing in-app notification inbox.
 * Skips insert when the user is already compliant (password policy / MFA enrolled).
 * Dedupes by unread row with the same title when a nudge is still warranted.
 */
export async function ensureSecurityNotifications(
  options: EnsureOptions,
): Promise<void> {
  try {
    const [passwordNudge, mfaNudge] = await Promise.all([
      needsPasswordUpdateNudge(options.authUid),
      needsMfaEnrollmentNudge(options.authUid),
    ]);

    if (passwordNudge) {
      if (options.persona === "staff") {
        await ensureStaffNotification({
          authUid: options.authUid,
          tenantId: options.tenantId,
          title: SECURITY_NOTIFICATION.passwordTitle,
          body: SECURITY_NOTIFICATION.passwordBody,
          actionUrl: options.passwordActionUrl,
        });
      } else if (options.persona === "lessee" && options.lesseeId) {
        const already = await hasUnreadSecurityNotification(
          "lessee_notifications",
          options.authUid,
          SECURITY_NOTIFICATION.passwordTitle,
        );
        if (!already) {
          await insertLesseePortalNotification({
            landlordTenantId: options.tenantId,
            lesseeId: options.lesseeId,
            title: SECURITY_NOTIFICATION.passwordTitle,
            body: SECURITY_NOTIFICATION.passwordBody,
            actionUrl: options.passwordActionUrl,
            context: "password-policy-nudge",
          });
        }
      } else if (options.persona === "landlord") {
        const already = await hasUnreadSecurityNotification(
          "landlord_notifications",
          options.authUid,
          SECURITY_NOTIFICATION.passwordTitle,
        );
        if (!already) {
          await insertLandlordPortalNotification({
            landlordTenantId: options.tenantId,
            title: SECURITY_NOTIFICATION.passwordTitle,
            body: SECURITY_NOTIFICATION.passwordBody,
            actionUrl: options.passwordActionUrl,
            context: "password-policy-nudge",
          });
        }
      }
    }

    if (mfaNudge) {
      if (options.persona === "staff") {
        await ensureStaffNotification({
          authUid: options.authUid,
          tenantId: options.tenantId,
          title: SECURITY_NOTIFICATION.mfaTitle,
          body: SECURITY_NOTIFICATION.mfaBody,
          actionUrl: options.mfaActionUrl,
        });
      } else if (options.persona === "lessee" && options.lesseeId) {
        const already = await hasUnreadSecurityNotification(
          "lessee_notifications",
          options.authUid,
          SECURITY_NOTIFICATION.mfaTitle,
        );
        if (!already) {
          await insertLesseePortalNotification({
            landlordTenantId: options.tenantId,
            lesseeId: options.lesseeId,
            title: SECURITY_NOTIFICATION.mfaTitle,
            body: SECURITY_NOTIFICATION.mfaBody,
            actionUrl: options.mfaActionUrl,
            context: "mfa-enrollment-nudge",
          });
        }
      } else if (options.persona === "landlord") {
        const already = await hasUnreadSecurityNotification(
          "landlord_notifications",
          options.authUid,
          SECURITY_NOTIFICATION.mfaTitle,
        );
        if (!already) {
          await insertLandlordPortalNotification({
            landlordTenantId: options.tenantId,
            title: SECURITY_NOTIFICATION.mfaTitle,
            body: SECURITY_NOTIFICATION.mfaBody,
            actionUrl: options.mfaActionUrl,
            context: "mfa-enrollment-nudge",
          });
        }
      }
    }
  } catch (error) {
    console.error(
      "[security-notifications] ensure failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
