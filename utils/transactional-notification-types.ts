export const TRANSACTIONAL_EVENT_TYPES = [
  "sale_completed",
  "payment_received",
  "invoice_created",
  "payment_due_reminder",
] as const;

export type TransactionalEventType = (typeof TRANSACTIONAL_EVENT_TYPES)[number];

export const TRANSACTIONAL_EVENT_LABELS: Record<TransactionalEventType, string> =
  {
    sale_completed: "Sale Completed",
    payment_received: "Payment Received",
    invoice_created: "Invoice Created",
    payment_due_reminder: "Payment Due Reminder",
  };

export const TRANSACTIONAL_CHANNELS = ["email", "sms", "both"] as const;
export type TransactionalNotificationChannel =
  (typeof TRANSACTIONAL_CHANNELS)[number];

export type TransactionalNotificationRuleRow = {
  id: string | null;
  tenant_id: string;
  event_type: TransactionalEventType;
  template_id: string | null;
  channel: TransactionalNotificationChannel | null;
  is_active: boolean;
  configured: boolean;
  template_name?: string | null;
};

export type TransactionalNotificationRuleInput = {
  event_type?: string;
  template_id?: string | null;
  channel?: string | null;
  is_active?: boolean;
};

export function defaultChannelFromTemplate(
  templateChannel: string,
): TransactionalNotificationChannel {
  if (templateChannel === "sms") return "sms";
  if (templateChannel === "both") return "both";
  return "email";
}

export function validateRuleUpsert(
  body: TransactionalNotificationRuleInput,
): string | null {
  const eventType = body.event_type?.trim() ?? "";
  if (
    !(TRANSACTIONAL_EVENT_TYPES as readonly string[]).includes(eventType)
  ) {
    return "event_type must be sale_completed, payment_received, invoice_created, or payment_due_reminder.";
  }

  const templateId = body.template_id?.trim() ?? "";
  if (!templateId) {
    return "Select a transactional template before saving.";
  }

  const channel = (body.channel ?? "").trim();
  if (
    channel &&
    !(TRANSACTIONAL_CHANNELS as readonly string[]).includes(channel)
  ) {
    return "Channel must be email, sms, or both.";
  }

  return null;
}

export function buildDefaultRules(
  tenantId: string,
): TransactionalNotificationRuleRow[] {
  return TRANSACTIONAL_EVENT_TYPES.map((eventType) => ({
    id: null,
    tenant_id: tenantId,
    event_type: eventType,
    template_id: null,
    channel: null,
    is_active: false,
    configured: false,
    template_name: null,
  }));
}

export function mergeRulesWithDefaults(
  tenantId: string,
  rows: Array<{
    id: string;
    tenant_id: string;
    event_type: string;
    template_id: string;
    channel: string;
    is_active: boolean;
    message_templates?:
      | { name: string }
      | { name: string }[]
      | null;
  }>,
): TransactionalNotificationRuleRow[] {
  const byEvent = new Map(
    rows.map((row) => {
      const template = Array.isArray(row.message_templates)
        ? row.message_templates[0]
        : row.message_templates;
      return [
        row.event_type,
        {
          id: row.id,
          tenant_id: row.tenant_id,
          event_type: row.event_type as TransactionalEventType,
          template_id: row.template_id,
          channel: row.channel as TransactionalNotificationChannel,
          is_active: row.is_active === true,
          configured: true,
          template_name: template?.name ?? null,
        } satisfies TransactionalNotificationRuleRow,
      ];
    }),
  );

  return TRANSACTIONAL_EVENT_TYPES.map((eventType) => {
    return (
      byEvent.get(eventType) ?? {
        id: null,
        tenant_id: tenantId,
        event_type: eventType,
        template_id: null,
        channel: null,
        is_active: false,
        configured: false,
        template_name: null,
      }
    );
  });
}
