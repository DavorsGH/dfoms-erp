import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolvePushSubscriptionContext } from "@/utils/push-subscription-auth";
import { isPushPersona } from "@/utils/push-notification-types";

export async function DELETE(request: Request) {
  let body: { persona?: unknown; endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!isPushPersona(body.persona)) {
    return NextResponse.json({ error: "Invalid persona." }, { status: 400 });
  }

  const context = await resolvePushSubscriptionContext(body.persona);
  if (!context.ok) {
    return context.response;
  }

  const admin = createAdminClient();
  let query = admin
    .from("push_subscriptions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("persona", context.persona)
    .eq("recipient_user_id", context.userId)
    .eq("tenant_id", context.tenantId)
    .is("revoked_at", null);

  const endpoint = body.endpoint?.trim();
  if (endpoint) {
    query = query.eq("endpoint", endpoint);
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
