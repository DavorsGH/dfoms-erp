import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export const EMAIL_DELIVERY_EVENT_TYPES = [
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "delivery_delayed",
] as const;

export type EmailDeliveryEventType = (typeof EMAIL_DELIVERY_EVENT_TYPES)[number];

export function mapResendWebhookEventType(
  resendType: string,
): EmailDeliveryEventType | null {
  switch (resendType.trim().toLowerCase()) {
    case "email.sent":
      return "sent";
    case "email.delivered":
      return "delivered";
    case "email.opened":
      return "opened";
    case "email.clicked":
      return "clicked";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    case "email.delivery_delayed":
      return "delivery_delayed";
    default:
      return null;
  }
}

export async function resolveTenantIdForResendMessage(
  admin: SupabaseClient,
  resendMessageId: string,
): Promise<string | null> {
  const messageId = resendMessageId.trim();
  if (!messageId) {
    return null;
  }

  const { data: fromInbox } = await admin
    .from("client_notifications")
    .select("tenant_id")
    .eq("resend_message_id", messageId)
    .limit(1)
    .maybeSingle();

  if (fromInbox?.tenant_id) {
    return fromInbox.tenant_id as string;
  }

  const { data: fromLog } = await admin
    .from("transactional_notification_email_log")
    .select("tenant_id")
    .eq("resend_message_id", messageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (fromLog?.tenant_id as string | undefined) ?? null;
}

export async function insertEmailDeliveryEvent(
  admin: SupabaseClient,
  options: {
    tenantId: string | null;
    resendMessageId: string;
    eventType: EmailDeliveryEventType;
    eventData: Record<string, unknown>;
    occurredAt: string;
  },
): Promise<void> {
  const { error } = await admin.from("email_delivery_events").insert({
    tenant_id: options.tenantId,
    resend_message_id: options.resendMessageId.trim(),
    event_type: options.eventType,
    event_data: options.eventData,
    occurred_at: options.occurredAt,
  });

  if (error) {
    console.error(
      `[email-delivery-events] insert failed (${options.eventType}/${options.resendMessageId}):`,
      error.message,
    );
  }
}
