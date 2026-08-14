import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import type { PushPersona } from "@/utils/push-notification-types";
import { resolvePushNotificationUrl } from "@/utils/push-notification-urls";
import { isWebPushConfigured, webpush } from "@/utils/web-push-config";

type SendWebPushOptions = {
  persona: PushPersona;
  recipientUserId: string;
  tenantId: string;
  title: string;
  body: string;
  actionUrl?: string | null;
  notificationId?: string | null;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
};

function truncateBody(value: string, max = 240): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Best-effort Web Push fan-out to all active subscriptions for one recipient.
 * Never throws. Marks revoked_at when the push service returns 404/410.
 */
export async function sendWebPushForRecipient(
  options: SendWebPushOptions,
): Promise<void> {
  const recipientUserId = options.recipientUserId.trim();
  const tenantId = options.tenantId.trim();
  const title = options.title.trim();
  const body = truncateBody(options.body);

  if (!recipientUserId || !tenantId || !title || !body) {
    return;
  }

  if (!isWebPushConfigured()) {
    console.warn("[web-push-send] skipped: VAPID not configured in this process");
    return;
  }

  console.info("[web-push-send] start", {
    persona: options.persona,
    recipientUserId,
    tenantId,
    title,
  });

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth_key")
      .eq("persona", options.persona)
      .eq("recipient_user_id", recipientUserId)
      .eq("tenant_id", tenantId)
      .is("revoked_at", null);

    if (error) {
      console.error("[web-push-send] subscription lookup failed:", error.message);
      return;
    }

    const subscriptions = (data ?? []) as PushSubscriptionRow[];
    console.info("[web-push-send] subscriptions found:", subscriptions.length);
    if (subscriptions.length === 0) {
      return;
    }

    const clickUrl = resolvePushNotificationUrl(options.persona, options.actionUrl);
    const payload = JSON.stringify({
      title,
      body,
      url: clickUrl,
      tag: options.notificationId?.trim() || `${options.persona}:${recipientUserId}:${Date.now()}`,
      notificationId: options.notificationId?.trim() || null,
    });

    const nowIso = new Date().toISOString();

    await Promise.all(
      subscriptions.map(async (row) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: row.endpoint,
              keys: {
                p256dh: row.p256dh,
                auth: row.auth_key,
              },
            },
            payload,
          );

          console.info("[web-push-send] delivery ok", {
            subscriptionId: row.id,
            endpoint: `${row.endpoint.slice(0, 48)}…`,
          });

          await admin
            .from("push_subscriptions")
            .update({ last_used_at: nowIso })
            .eq("id", row.id);
        } catch (error) {
          const statusCode =
            error &&
            typeof error === "object" &&
            "statusCode" in error &&
            typeof (error as { statusCode?: unknown }).statusCode === "number"
              ? (error as { statusCode: number }).statusCode
              : null;

          if (statusCode === 404 || statusCode === 410) {
            await admin
              .from("push_subscriptions")
              .update({ revoked_at: nowIso })
              .eq("id", row.id);
            return;
          }

          console.error(
            "[web-push-send] delivery failed:",
            {
              subscriptionId: row.id,
              statusCode,
              message: error instanceof Error ? error.message : String(error),
              body:
                error &&
                typeof error === "object" &&
                "body" in error &&
                typeof (error as { body?: unknown }).body === "string"
                  ? (error as { body: string }).body
                  : null,
            },
          );
        }
      }),
    );
  } catch (error) {
    console.error(
      "[web-push-send] failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
