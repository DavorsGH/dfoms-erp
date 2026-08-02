import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Best-effort lessee portal in-app insert (service_role).
 * Only inserts when lessees.auth_user_id is set (accepted portal invite).
 * Never throws — failures are logged so email/SMS dispatch stays intact.
 */
/** @returns true when an inbox row was inserted. */
export async function insertLesseePortalNotification(options: {
  landlordTenantId: string;
  lesseeId: string;
  title: string;
  body: string;
  actionUrl: string | null;
  context: string;
}): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data: lessee, error: lesseeError } = await admin
      .from("lessees")
      .select("auth_user_id")
      .eq("tenant_id", options.landlordTenantId)
      .eq("lessee_id", options.lesseeId)
      .maybeSingle();

    if (lesseeError) {
      console.error(
        `[lessee-portal-notifications] lessee lookup failed (${options.context}):`,
        lesseeError.message,
      );
      return false;
    }

    const authUserId =
      typeof lessee?.auth_user_id === "string"
        ? lessee.auth_user_id.trim()
        : "";
    if (!authUserId) {
      return false;
    }

    const { error } = await admin.from("lessee_notifications").insert({
      tenant_id: options.landlordTenantId,
      recipient_user_id: authUserId,
      lessee_id: options.lesseeId,
      announcement_id: null,
      title: options.title,
      body: options.body,
      action_url: options.actionUrl,
    });

    if (error) {
      console.error(
        `[lessee-portal-notifications] insert failed (${options.context}):`,
        error.message,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      `[lessee-portal-notifications] insert failed (${options.context}):`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
