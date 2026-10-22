import { NextResponse } from "next/server";
import { resolvePushSubscriptionContext } from "@/utils/push-subscription-auth";
import { sendWebPushForRecipient } from "@/utils/web-push-send";

export async function POST(request: Request) {
  let body: { persona?: unknown; endpoint?: unknown };
  try {
    body = (await request.json()) as { persona?: unknown; endpoint?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const context = await resolvePushSubscriptionContext(body.persona);
  if (!context.ok) {
    return context.response;
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) {
    return NextResponse.json(
      { error: "This device is not subscribed." },
      { status: 400 },
    );
  }

  const actionUrl =
    context.persona === "lessee"
      ? "/portal/account"
      : context.persona === "landlord"
        ? "/landlord-portal/account"
        : "/dashboard/my-account";

  const result = await sendWebPushForRecipient({
    persona: context.persona,
    recipientUserId: context.userId,
    tenantId: context.tenantId,
    title: "Test notification",
    body: "Push notifications are working on this device.",
    actionUrl,
    endpoint,
  });

  if (result.delivered < 1) {
    return NextResponse.json(
      {
        error:
          result.error ?? "The test notification could not be delivered.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, delivered: result.delivered });
}
