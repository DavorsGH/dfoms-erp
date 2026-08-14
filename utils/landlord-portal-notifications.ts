import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import { sendWebPushForRecipient } from "@/utils/web-push-send";

/**
 * Best-effort landlord portal in-app insert (service_role).
 * Only inserts when landlords.auth_user_id is set (accepted portal invite).
 * Never throws — failures are logged so email/SMS dispatch stays intact.
 */
/** @returns true when an inbox row was inserted. */
export async function insertLandlordPortalNotification(options: {
  landlordTenantId: string;
  title: string;
  body: string;
  actionUrl: string | null;
  context: string;
}): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data: landlord, error: landlordError } = await admin
      .from("landlords")
      .select("auth_user_id")
      .eq("tenant_id", options.landlordTenantId)
      .maybeSingle();

    if (landlordError) {
      console.error(
        `[landlord-portal-notifications] landlord lookup failed (${options.context}):`,
        landlordError.message,
      );
      return false;
    }

    const authUserId =
      typeof landlord?.auth_user_id === "string"
        ? landlord.auth_user_id.trim()
        : "";
    if (!authUserId) {
      // No portal login — email/SMS only (caller still sends those channels).
      return false;
    }

    const { data: inserted, error } = await admin
      .from("landlord_notifications")
      .insert({
        tenant_id: options.landlordTenantId,
        recipient_user_id: authUserId,
        announcement_id: null,
        title: options.title,
        body: options.body,
        action_url: options.actionUrl,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error(
        `[landlord-portal-notifications] insert failed (${options.context}):`,
        error.message,
      );
      return false;
    }

    if (inserted?.id) {
      await sendWebPushForRecipient({
        persona: "landlord",
        recipientUserId: authUserId,
        tenantId: options.landlordTenantId,
        title: options.title,
        body: options.body,
        actionUrl: options.actionUrl,
        notificationId: inserted.id,
      });
    }

    return true;
  } catch (error) {
    console.error(
      `[landlord-portal-notifications] insert failed (${options.context}):`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
