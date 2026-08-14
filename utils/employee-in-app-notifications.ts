import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  isMissingActionUrlColumnError,
} from "@/utils/employee-notifications-types";
import { sendWebPushForRecipient } from "@/utils/web-push-send";

export type EmployeeInAppNotificationInsert = {
  tenant_id: string;
  recipient_user_id: string;
  announcement_id?: string | null;
  title: string;
  body: string;
  action_url?: string | null;
};

type InsertedEmployeeNotification = {
  id: string;
  tenant_id: string;
  recipient_user_id: string;
  title: string;
  body: string;
  action_url: string | null;
};

async function fanOutStaffPush(rows: InsertedEmployeeNotification[]): Promise<void> {
  await Promise.all(
    rows.map((row) =>
      sendWebPushForRecipient({
        persona: "staff",
        recipientUserId: row.recipient_user_id,
        tenantId: row.tenant_id,
        title: row.title,
        body: row.action_url
          ? `${row.body}\n${row.action_url}`
          : row.body,
        actionUrl: row.action_url,
        notificationId: row.id,
      }),
    ),
  );
}

/**
 * Insert staff in-app notification rows and fan-out Web Push (best-effort).
 * Uses admin client by default; accepts a caller Supabase client for announcement sends.
 */
export async function insertEmployeeInAppNotifications(options: {
  rows: EmployeeInAppNotificationInsert[];
  context: string;
  supabase?: SupabaseClient;
}): Promise<boolean> {
  const rows = options.rows
    .map((row) => ({
      tenant_id: row.tenant_id.trim(),
      recipient_user_id: row.recipient_user_id.trim(),
      announcement_id: row.announcement_id ?? null,
      title: row.title.trim(),
      body: row.body.trim(),
      action_url: row.action_url?.trim() || null,
    }))
    .filter((row) => row.tenant_id && row.recipient_user_id && row.title && row.body);

  if (rows.length === 0) {
    return true;
  }

  const client = options.supabase ?? createAdminClient();

  try {
    let insertResult = await client
      .from("employee_notifications")
      .insert(rows)
      .select("id, tenant_id, recipient_user_id, title, body, action_url");

    if (insertResult.error) {
      const hasActionUrl = rows.some((row) => row.action_url);
      if (hasActionUrl && isMissingActionUrlColumnError(insertResult.error.message)) {
        const legacyRows = rows.map((row) => ({
          tenant_id: row.tenant_id,
          recipient_user_id: row.recipient_user_id,
          announcement_id: row.announcement_id,
          title: row.title,
          body: row.action_url ? `${row.body}\n${row.action_url}` : row.body,
        }));
        insertResult = await client
          .from("employee_notifications")
          .insert(legacyRows)
          .select("id, tenant_id, recipient_user_id, title, body, action_url");
      }
    }

    if (insertResult.error) {
      console.error(
        `[employee-in-app-notifications] insert failed (${options.context}):`,
        insertResult.error.message,
      );
      return false;
    }

    const inserted = (insertResult.data ?? []) as InsertedEmployeeNotification[];
    await fanOutStaffPush(inserted);
    return true;
  } catch (error) {
    console.error(
      `[employee-in-app-notifications] failed (${options.context}):`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/** Convenience wrapper for a single staff notification row. */
export async function insertEmployeeInAppNotification(options: {
  row: EmployeeInAppNotificationInsert;
  context: string;
  supabase?: SupabaseClient;
}): Promise<boolean> {
  return insertEmployeeInAppNotifications({
    rows: [options.row],
    context: options.context,
    supabase: options.supabase,
  });
}
