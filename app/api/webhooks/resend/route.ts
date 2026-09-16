import { NextResponse } from "next/server";
import {
  insertEmailDeliveryEvent,
  mapResendWebhookEventType,
  resolveTenantIdForResendMessage,
} from "@/utils/email-delivery-events";
import { verifyResendWebhookSignature } from "@/utils/resend-webhook-verify";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

type ResendWebhookPayload = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    [key: string]: unknown;
  };
};

function extractResendMessageId(payload: ResendWebhookPayload): string | null {
  const fromData = payload.data?.email_id;
  if (typeof fromData === "string" && fromData.trim()) {
    return fromData.trim();
  }
  return null;
}

function extractOccurredAt(payload: ResendWebhookPayload): string {
  const candidates = [
    payload.created_at,
    payload.data?.created_at,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }
  return new Date().toISOString();
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret?.trim()) {
    return NextResponse.json(
      { error: "Webhook verification is not configured." },
      { status: 401 },
    );
  }

  const rawBody = await request.text();
  const verified = verifyResendWebhookSignature({
    rawBody,
    svixId: request.headers.get("svix-id"),
    svixTimestamp: request.headers.get("svix-timestamp"),
    svixSignature: request.headers.get("svix-signature"),
    secret,
  });

  if (!verified) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ResendWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const resendType = payload.type?.trim() ?? "";
  const eventType = mapResendWebhookEventType(resendType);
  if (!eventType) {
    return NextResponse.json({ received: true, ignored: resendType || "unknown" });
  }

  const resendMessageId = extractResendMessageId(payload);
  if (!resendMessageId) {
    return NextResponse.json(
      { error: "Missing email_id in webhook payload." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const tenantId = await resolveTenantIdForResendMessage(admin, resendMessageId);

  await insertEmailDeliveryEvent(admin, {
    tenantId,
    resendMessageId,
    eventType,
    eventData: payload as Record<string, unknown>,
    occurredAt: extractOccurredAt(payload),
  });

  return NextResponse.json({
    received: true,
    event_type: eventType,
    tenant_resolved: tenantId != null,
  });
}
