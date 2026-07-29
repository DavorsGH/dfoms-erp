import "server-only";

import { sendHubtelSms } from "@/utils/hubtel-sms";
import {
  substituteTemplatePlaceholders,
  templateBodyToEmailHtml,
} from "@/utils/message-template-render";
import { sendResendEmail } from "@/utils/resend-email";
import { tryDebitSmsCredit } from "@/utils/sms-credit";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  TRANSACTIONAL_EVENT_TYPES,
  type TransactionalEventType,
  type TransactionalNotificationChannel,
} from "@/utils/transactional-notification-types";

function isEventType(value: string): value is TransactionalEventType {
  return (TRANSACTIONAL_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Best-effort customer transactional notification.
 * Never throws — failures are logged only.
 * Intentionally bypasses customer_comm_preferences opt-out (operational messages).
 */
export async function fireTransactionalNotification(
  tenantId: string,
  eventType: TransactionalEventType | string,
  customerId: string | null | undefined,
  variables: Record<string, string>,
): Promise<void> {
  try {
    if (!tenantId?.trim()) {
      console.warn(
        "[transactional-notification] Skipping: missing tenantId.",
      );
      return;
    }
    if (!isEventType(eventType)) {
      console.warn(
        `[transactional-notification] Skipping: unknown event_type "${eventType}".`,
      );
      return;
    }
    const clientId = (customerId ?? "").trim();
    if (!clientId) {
      console.warn(
        `[transactional-notification] Skipping ${eventType}: no customerId.`,
      );
      return;
    }

    const admin = createAdminClient();

    const { data: rule, error: ruleError } = await admin
      .from("transactional_notification_rules")
      .select("id, template_id, channel, is_active")
      .eq("tenant_id", tenantId)
      .eq("event_type", eventType)
      .maybeSingle();

    if (ruleError) {
      console.error(
        `[transactional-notification] Rule lookup failed (${eventType}):`,
        ruleError.message,
      );
      return;
    }

    if (!rule || rule.is_active !== true || !rule.template_id) {
      return;
    }

    const channel = String(rule.channel) as TransactionalNotificationChannel;

    const { data: template, error: templateError } = await admin
      .from("message_templates")
      .select(
        "id, subject, body_email, body_sms, channel, is_active, template_type",
      )
      .eq("id", rule.template_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (templateError) {
      console.error(
        `[transactional-notification] Template lookup failed (${eventType}):`,
        templateError.message,
      );
      return;
    }

    if (!template || template.is_active !== true) {
      console.warn(
        `[transactional-notification] Skipping ${eventType}: template missing or inactive.`,
      );
      return;
    }

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .select("client_id, client_name, email, phone")
      .eq("tenant_id", tenantId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (customerError) {
      console.error(
        `[transactional-notification] Customer lookup failed (${eventType}):`,
        customerError.message,
      );
      return;
    }

    if (!customer) {
      console.warn(
        `[transactional-notification] Skipping ${eventType}: customer ${clientId} not found.`,
      );
      return;
    }

    const vars: Record<string, string> = {
      customer_name:
        customer.client_name?.trim() ||
        variables.customer_name ||
        customer.client_id,
      customer_id: customer.client_id,
      ...variables,
    };

    const wantsSms = channel === "sms" || channel === "both";
    let smsCreditAvailable = false;

    if (wantsSms) {
      smsCreditAvailable = await tryDebitSmsCredit(tenantId);
      if (!smsCreditAvailable) {
        console.warn(
          `[transactional-notification] ${eventType}: no SMS credits for tenant ${tenantId}; falling back to email when needed.`,
        );
      }
    }

    // Email always for email/both; also for sms-only when debit failed (fallback).
    const sendEmail =
      channel === "email" ||
      channel === "both" ||
      (channel === "sms" && !smsCreditAvailable);
    const sendSms = smsCreditAvailable;

    if (sendEmail) {
      const to = (customer.email ?? "").trim();
      if (!to) {
        console.warn(
          `[transactional-notification] ${eventType}: no email on file for ${clientId}.`,
        );
      } else {
        const subject = substituteTemplatePlaceholders(
          template.subject ?? "",
          vars,
        );
        const rawBody = substituteTemplatePlaceholders(
          template.body_email ?? "",
          vars,
        );
        const html = templateBodyToEmailHtml(rawBody);
        const result = await sendResendEmail({
          to,
          subject,
          html,
          text: rawBody,
        });
        if (!result.ok) {
          console.error(
            `[transactional-notification] Email failed (${eventType}/${clientId}):`,
            result.error,
          );
        }
      }
    }

    if (sendSms) {
      const to = (customer.phone ?? "").trim();
      if (!to) {
        console.warn(
          `[transactional-notification] ${eventType}: no phone on file for ${clientId}.`,
        );
      } else {
        const content = substituteTemplatePlaceholders(
          template.body_sms ?? "",
          vars,
        );
        const result = await sendHubtelSms({ to, content });
        if (!result.ok) {
          console.error(
            `[transactional-notification] SMS failed (${eventType}/${clientId}):`,
            result.error,
          );
        }
      }
    }
  } catch (error) {
    console.error(
      `[transactional-notification] Failed ${eventType}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
