import { NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/system-event-log";
import { verifyPaystackWebhookSignature } from "@/utils/paystack";
import {
  processPaystackWebhookEvent,
  type PaystackWebhookEnvelope,
} from "@/utils/paystack-webhook";

export const runtime = "nodejs";

/**
 * Paystack webhook endpoint (public). Signature must be verified before any
 * business logic. Always returns 200 after a valid signature so Paystack does
 * not retry on internal processing errors (those are logged + ledgered).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!verifyPaystackWebhookSignature(rawBody, signature)) {
    console.warn("[paystack-webhook] Rejected request — invalid signature.");
    await logSystemEvent({
      eventType: "webhook",
      eventName: "paystack",
      status: "failure",
      message: "Invalid Paystack webhook signature",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let envelope: PaystackWebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody) as PaystackWebhookEnvelope;
  } catch {
    // Signature matched but body is not JSON — acknowledge to avoid retries.
    console.error("[paystack-webhook] Valid signature but body is not JSON.");
    await logSystemEvent({
      eventType: "webhook",
      eventName: "paystack",
      status: "failure",
      message: "Valid signature but request body is not JSON",
    });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const eventType = envelope.event?.trim() || "unknown";

  try {
    const result = await processPaystackWebhookEvent(envelope);
    if (result.outcome === "error") {
      console.error(
        `[paystack-webhook] ${result.eventType} ${result.eventKey}: ${result.detail}`,
      );
      await logSystemEvent({
        eventType: "webhook",
        eventName: "paystack",
        status: "failure",
        message: `${result.eventType}: ${result.detail}`,
        metadata: {
          eventKey: result.eventKey,
          eventType: result.eventType,
          outcome: result.outcome,
        },
      });
    } else if (result.outcome === "duplicate") {
      console.info(
        `[paystack-webhook] duplicate ${result.eventType} ${result.eventKey}`,
      );
      await logSystemEvent({
        eventType: "webhook",
        eventName: "paystack",
        status: "success",
        message: `duplicate ${result.eventType}: ${result.detail}`,
        metadata: {
          eventKey: result.eventKey,
          eventType: result.eventType,
          outcome: result.outcome,
        },
      });
    } else {
      console.info(
        `[paystack-webhook] ${result.outcome} ${result.eventType}: ${result.detail}`,
      );
      await logSystemEvent({
        eventType: "webhook",
        eventName: "paystack",
        status: "success",
        message: `${result.eventType}: ${result.detail}`,
        metadata: {
          eventKey: result.eventKey,
          eventType: result.eventType,
          outcome: result.outcome,
        },
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected webhook processing failure";
    console.error(
      "[paystack-webhook] Unexpected failure after signature verification:",
      error,
    );
    await logSystemEvent({
      eventType: "webhook",
      eventName: "paystack",
      status: "failure",
      message: `${eventType}: ${message}`,
    });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
