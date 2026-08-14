import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolvePushSubscriptionContext } from "@/utils/push-subscription-auth";

type PushSubscriptionJson = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const persona = searchParams.get("persona");
  const context = await resolvePushSubscriptionContext(persona);
  if (!context.ok) {
    return context.response;
  }

  const admin = createAdminClient();
  const { count, error } = await admin
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("persona", context.persona)
    .eq("recipient_user_id", context.userId)
    .eq("tenant_id", context.tenantId)
    .is("revoked_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ subscribed: (count ?? 0) > 0 });
}

export async function POST(request: Request) {
  let body: {
    persona?: unknown;
    subscription?: PushSubscriptionJson;
    isStandalonePwa?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const context = await resolvePushSubscriptionContext(body.persona);
  if (!context.ok) {
    return context.response;
  }

  const subscription = body.subscription;
  const endpoint = subscription?.endpoint?.trim() ?? "";
  const p256dh = subscription?.keys?.p256dh?.trim() ?? "";
  const authKey = subscription?.keys?.auth?.trim() ?? "";

  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json(
      { error: "Invalid push subscription payload." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const userAgent = request.headers.get("user-agent");
  const nowIso = new Date().toISOString();

  const { error } = await admin.from("push_subscriptions").upsert(
    {
      recipient_user_id: context.userId,
      persona: context.persona,
      tenant_id: context.tenantId,
      endpoint,
      p256dh,
      auth_key: authKey,
      user_agent: userAgent,
      is_standalone_pwa: body.isStandalonePwa === true,
      revoked_at: null,
      last_used_at: nowIso,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
