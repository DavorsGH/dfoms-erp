import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import {
  staffAuditActorLabel,
  validateAdminCustomerTenantId,
} from "@/utils/admin-tenant-api";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { logSystemEvent } from "@/lib/system-event-log";

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

  const { waived } = body;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (typeof waived !== "boolean") {
    return NextResponse.json(
      { error: "tenant_id and waived (boolean) are required" },
      { status: 400 },
    );
  }

  const tenantValidation = validateAdminCustomerTenantId(body.tenant_id);
  if (!tenantValidation.ok) {
    return tenantValidation.response;
  }
  const tenant_id = tenantValidation.tenantId;

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
  const waivedBy = staffAuditActorLabel(user);

  const admin = createAdminClient();

  const { data: subscription, error: subscriptionError } = await admin
    .from("crm_subscriptions")
    .select("id, billing_waived, trial_end_date")
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

  const oldTrialEndDate = subscription.trial_end_date ?? null;
  let newTrialEndDate: string | null = oldTrialEndDate;

  if (!waived && subscription.billing_waived === true) {
    const { data: graceEnd, error: graceError } = await admin.rpc(
      "grant_post_waiver_grace_period",
      {
        p_tenant_id: tenant_id,
        p_grace_days: 14,
      },
    );

    if (graceError) {
      return NextResponse.json({ error: graceError.message }, { status: 400 });
    }

    newTrialEndDate =
      typeof graceEnd === "string"
        ? graceEnd.slice(0, 10)
        : oldTrialEndDate;

    await logSystemEvent({
      eventType: "payment",
      eventName: "billing_waiver_revoked_grace_period",
      status: "success",
      message: `Granted 14-day post-waiver grace for tenant ${tenant_id}.`,
      metadata: {
        tenant_id,
        revoked_by: waivedBy,
        old_trial_end_date: oldTrialEndDate,
        new_trial_end_date: newTrialEndDate,
      },
    });
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

  return NextResponse.json({
    success: true,
    ...updatePayload,
    old_trial_end_date: oldTrialEndDate,
    new_trial_end_date: newTrialEndDate,
  });
}
