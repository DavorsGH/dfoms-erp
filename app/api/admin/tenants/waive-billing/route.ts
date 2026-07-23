import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

type WaiveBillingBody = {
  tenant_id?: string;
  waived?: boolean;
  reason?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: WaiveBillingBody;
  try {
    body = (await request.json()) as WaiveBillingBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { tenant_id, waived } = body;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!tenant_id || typeof waived !== "boolean") {
    return NextResponse.json(
      { error: "tenant_id and waived (boolean) are required" },
      { status: 400 },
    );
  }

  if (tenant_id === DAVORS_TENANT_ID) {
    return NextResponse.json(
      { error: "The platform tenant cannot be modified from this screen." },
      { status: 400 },
    );
  }

  if (waived && !reason) {
    return NextResponse.json(
      { error: "A reason is required when waiving billing." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const waivedBy =
    user?.email?.trim() ||
    user?.id ||
    "davors-platform-super-admin";

  const admin = createAdminClient();

  const { data: subscription, error: subscriptionError } = await admin
    .from("crm_subscriptions")
    .select("id")
    .eq("linked_tenant_id", tenant_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError) {
    return NextResponse.json({ error: subscriptionError.message }, { status: 400 });
  }

  if (!subscription) {
    return NextResponse.json(
      { error: "No subscription record exists for this tenant." },
      { status: 404 },
    );
  }

  const updatePayload = waived
    ? {
        billing_waived: true,
        billing_waived_reason: reason,
        billing_waived_by: waivedBy,
        billing_waived_at: new Date().toISOString(),
      }
    : {
        billing_waived: false,
        billing_waived_reason: null,
        billing_waived_by: null,
        billing_waived_at: null,
      };

  const { error: updateError } = await admin
    .from("crm_subscriptions")
    .update(updatePayload)
    .eq("id", subscription.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, ...updatePayload });
}
