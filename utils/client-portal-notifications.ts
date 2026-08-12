import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Best-effort customer portal in-app insert (service_role).
 * Only inserts when a client-role user_accounts row exists with auth_uid set.
 */
export async function insertClientPortalNotification(options: {
  tenantId: string;
  clientId: string;
  title: string;
  body: string;
  actionUrl: string | null;
  context: string;
}): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data: account, error: accountError } = await admin
      .from("user_accounts")
      .select("auth_uid")
      .eq("tenant_id", options.tenantId)
      .eq("client_id", options.clientId)
      .eq("role", "client")
      .neq("is_active", false)
      .maybeSingle();

    if (accountError) {
      console.error(
        `[client-portal-notifications] account lookup failed (${options.context}):`,
        accountError.message,
      );
      return false;
    }

    const authUserId =
      typeof account?.auth_uid === "string" ? account.auth_uid.trim() : "";
    if (!authUserId) {
      return false;
    }

    const { error } = await admin.from("client_notifications").insert({
      tenant_id: options.tenantId,
      recipient_user_id: authUserId,
      client_id: options.clientId,
      announcement_id: null,
      title: options.title,
      body: options.body,
      action_url: options.actionUrl,
    });

    if (error) {
      console.error(
        `[client-portal-notifications] insert failed (${options.context}):`,
        error.message,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      `[client-portal-notifications] insert failed (${options.context}):`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
