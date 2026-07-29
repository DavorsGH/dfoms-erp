import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";

type RouteContext = {
  params: Promise<{ token: string }>;
};

/**
 * Public unsubscribe API. Prefer the branded page at /unsubscribe/[token];
 * this endpoint exists for programmatic confirmation.
 */
export async function POST(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const cleaned = token?.trim() ?? "";
  if (!cleaned) {
    return NextResponse.json(
      { ok: false, message: "This link is no longer valid." },
      { status: 200 },
    );
  }

  const admin = createAdminClient();
  const { data: pref, error } = await admin
    .from("customer_comm_preferences")
    .select("id, tenant_id, unsubscribed_at")
    .eq("unsubscribe_token", cleaned)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, message: "This link is no longer valid." },
      { status: 200 },
    );
  }

  if (!pref) {
    return NextResponse.json(
      { ok: false, message: "This link is no longer valid." },
      { status: 200 },
    );
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", pref.tenant_id)
    .maybeSingle();

  const tenantName = tenant?.name?.trim() || "this workspace";

  if (!pref.unsubscribed_at) {
    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("customer_comm_preferences")
      .update({
        unsubscribed_at: now,
        email_opt_in: false,
        sms_opt_in: false,
        updated_at: now,
      })
      .eq("id", pref.id)
      .eq("tenant_id", pref.tenant_id);

    if (updateError) {
      return NextResponse.json(
        { ok: false, message: "This link is no longer valid." },
        { status: 200 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    message: `You've been unsubscribed from ${tenantName}'s communications.`,
    tenantName,
  });
}
