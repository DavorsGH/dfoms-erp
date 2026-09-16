import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInvoiceDate } from "@/utils/client-invoices-types";
import type { EmailDeliveryEventType } from "@/utils/email-delivery-events";

export type EmailDeliveryTimelineStep = {
  event_type: EmailDeliveryEventType;
  occurred_at: string;
};

export type QuotationEmailDeliverySummary = {
  resend_message_id: string | null;
  badge: QuotationEmailDeliveryBadge | null;
  timeline: EmailDeliveryTimelineStep[];
};

export type QuotationEmailDeliveryBadge =
  | { kind: "delivered"; label: "Delivered" }
  | { kind: "opened"; label: string; occurred_at: string }
  | { kind: "not_opened"; label: "Not yet opened" }
  | { kind: "failed"; label: "Bounced" | "Failed"; occurred_at?: string };

export function quotationSentNotificationContext(quotationId: string): string {
  return `quotation_sent/${quotationId.trim()}`;
}

function formatOpenedBadgeTime(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return formatInvoiceDate(iso.slice(0, 10));
    }
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function buildQuotationEmailDeliveryBadge(
  events: EmailDeliveryTimelineStep[],
): QuotationEmailDeliveryBadge | null {
  if (events.length === 0) {
    return null;
  }

  const byType = (type: EmailDeliveryEventType) =>
    events.filter((event) => event.event_type === type);

  const bounced = byType("bounced");
  if (bounced.length > 0) {
    return {
      kind: "failed",
      label: "Bounced",
      occurred_at: bounced[bounced.length - 1]?.occurred_at,
    };
  }

  const complained = byType("complained");
  if (complained.length > 0) {
    return {
      kind: "failed",
      label: "Failed",
      occurred_at: complained[complained.length - 1]?.occurred_at,
    };
  }

  const opened = byType("opened");
  if (opened.length > 0) {
    const latest = opened[opened.length - 1]!;
    return {
      kind: "opened",
      label: `Opened ${formatOpenedBadgeTime(latest.occurred_at)}`,
      occurred_at: latest.occurred_at,
    };
  }

  const clicked = byType("clicked");
  if (clicked.length > 0) {
    const latest = clicked[clicked.length - 1]!;
    return {
      kind: "opened",
      label: `Opened ${formatOpenedBadgeTime(latest.occurred_at)}`,
      occurred_at: latest.occurred_at,
    };
  }

  const delivered = byType("delivered");
  if (delivered.length > 0) {
    return { kind: "not_opened", label: "Not yet opened" };
  }

  return null;
}

export function buildEmailDeliveryTimeline(
  events: EmailDeliveryTimelineStep[],
): EmailDeliveryTimelineStep[] {
  const pickLatest = (type: EmailDeliveryEventType) => {
    const matches = events.filter((event) => event.event_type === type);
    if (matches.length === 0) {
      return null;
    }
    return matches.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1)!;
  };

  const timeline: EmailDeliveryTimelineStep[] = [];
  const sent = pickLatest("sent");
  if (sent) {
    timeline.push(sent);
  }

  const delivered = pickLatest("delivered");
  if (delivered) {
    timeline.push(delivered);
  }

  const opened = pickLatest("opened");
  const clicked = pickLatest("clicked");
  if (opened && clicked) {
    timeline.push(opened.occurred_at >= clicked.occurred_at ? opened : clicked);
  } else if (opened) {
    timeline.push(opened);
  } else if (clicked) {
    timeline.push(clicked);
  }

  return timeline;
}

export async function loadQuotationEmailDeliverySummaries(
  supabase: SupabaseClient,
  tenantId: string,
  quotationIds: string[],
): Promise<Record<string, QuotationEmailDeliverySummary>> {
  const ids = quotationIds.map((id) => id.trim()).filter(Boolean);
  const result: Record<string, QuotationEmailDeliverySummary> = {};
  for (const id of ids) {
    result[id] = { resend_message_id: null, badge: null, timeline: [] };
  }

  if (ids.length === 0) {
    return result;
  }

  const contexts = ids.map((id) => quotationSentNotificationContext(id));

  const { data: logs, error: logError } = await supabase
    .from("transactional_notification_email_log")
    .select("notification_context, resend_message_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("event_type", "quotation_sent")
    .in("notification_context", contexts)
    .order("created_at", { ascending: false });

  if (logError || !logs) {
    return result;
  }

  const messageIdByQuotation = new Map<string, string>();
  for (const row of logs) {
    const context = row.notification_context?.trim() ?? "";
    const prefix = "quotation_sent/";
    if (!context.startsWith(prefix)) {
      continue;
    }
    const quotationId = context.slice(prefix.length);
    if (!quotationId || messageIdByQuotation.has(quotationId)) {
      continue;
    }
    const messageId = row.resend_message_id?.trim();
    if (messageId) {
      messageIdByQuotation.set(quotationId, messageId);
    }
  }

  const messageIds = [...new Set(messageIdByQuotation.values())];
  if (messageIds.length === 0) {
    return result;
  }

  const { data: events, error: eventsError } = await supabase
    .from("email_delivery_events")
    .select("resend_message_id, event_type, occurred_at")
    .in("resend_message_id", messageIds)
    .order("occurred_at", { ascending: true });

  if (eventsError || !events) {
    for (const [quotationId, messageId] of messageIdByQuotation) {
      result[quotationId] = {
        resend_message_id: messageId,
        badge: null,
        timeline: [],
      };
    }
    return result;
  }

  const eventsByMessage = new Map<string, EmailDeliveryTimelineStep[]>();
  for (const row of events) {
    const messageId = row.resend_message_id?.trim();
    if (!messageId) {
      continue;
    }
    const list = eventsByMessage.get(messageId) ?? [];
    list.push({
      event_type: row.event_type as EmailDeliveryEventType,
      occurred_at: row.occurred_at as string,
    });
    eventsByMessage.set(messageId, list);
  }

  for (const [quotationId, messageId] of messageIdByQuotation) {
    const timelineSteps = eventsByMessage.get(messageId) ?? [];
    result[quotationId] = {
      resend_message_id: messageId,
      badge: buildQuotationEmailDeliveryBadge(timelineSteps),
      timeline: buildEmailDeliveryTimeline(timelineSteps),
    };
  }

  return result;
}

export async function loadQuotationEmailDeliverySummary(
  supabase: SupabaseClient,
  tenantId: string,
  quotationId: string,
): Promise<QuotationEmailDeliverySummary> {
  const map = await loadQuotationEmailDeliverySummaries(supabase, tenantId, [
    quotationId,
  ]);
  return (
    map[quotationId] ?? {
      resend_message_id: null,
      badge: null,
      timeline: [],
    }
  );
}

export function formatEmailDeliveryTimelineLabel(
  eventType: EmailDeliveryEventType,
): string {
  switch (eventType) {
    case "sent":
      return "Sent";
    case "delivered":
      return "Delivered";
    case "opened":
      return "Opened";
    case "clicked":
      return "Clicked";
    default:
      return eventType;
  }
}

export function formatEmailDeliveryTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return iso;
    }
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
