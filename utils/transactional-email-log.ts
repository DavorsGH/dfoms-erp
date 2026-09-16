import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type TransactionalEmailDeliveryTracking = {
  /** e.g. quotation_sent/{quotationId} */
  notificationContext: string;
  /** When an inbox row was created, attach Resend id to that row too. */
  clientNotificationId?: string | null;
};

export async function persistTransactionalEmailLog(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    eventType: string;
    customerId: string;
    resendMessageId: string | null;
    notificationContext?: string | null;
  },
): Promise<void> {
  const messageId = options.resendMessageId?.trim() || null;
  if (!messageId) {
    return;
  }

  const { error } = await admin.from("transactional_notification_email_log").insert({
    tenant_id: options.tenantId,
    event_type: options.eventType,
    customer_id: options.customerId,
    resend_message_id: messageId,
    notification_context: options.notificationContext?.trim() || null,
  });

  if (error) {
    console.error(
      `[transactional-email-log] insert failed (${options.eventType}/${options.customerId}):`,
      error.message,
    );
  }
}

export async function attachResendMessageToClientNotification(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    clientNotificationId: string;
    resendMessageId: string;
    notificationContext?: string | null;
  },
): Promise<void> {
  const messageId = options.resendMessageId.trim();
  if (!messageId) {
    return;
  }

  const { error } = await admin
    .from("client_notifications")
    .update({
      resend_message_id: messageId,
      ...(options.notificationContext?.trim()
        ? { notification_context: options.notificationContext.trim() }
        : {}),
    })
    .eq("id", options.clientNotificationId)
    .eq("tenant_id", options.tenantId);

  if (error) {
    console.error(
      `[transactional-email-log] client_notifications update failed (${options.clientNotificationId}):`,
      error.message,
    );
  }
}

export async function recordTransactionalEmailSend(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    eventType: string;
    customerId: string;
    resendMessageId: string | null;
    tracking?: TransactionalEmailDeliveryTracking | null;
  },
): Promise<void> {
  const messageId = options.resendMessageId?.trim() || null;
  if (!messageId) {
    return;
  }

  const context = options.tracking?.notificationContext?.trim() || null;

  await persistTransactionalEmailLog(admin, {
    tenantId: options.tenantId,
    eventType: options.eventType,
    customerId: options.customerId,
    resendMessageId: messageId,
    notificationContext: context,
  });

  const notificationId = options.tracking?.clientNotificationId?.trim();
  if (notificationId) {
    await attachResendMessageToClientNotification(admin, {
      tenantId: options.tenantId,
      clientNotificationId: notificationId,
      resendMessageId: messageId,
      notificationContext: context,
    });
  }
}
