import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  disablePaystackSubscription,
  fetchPaystackSubscription,
} from "@/utils/paystack";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import {
  isSubscriptionCancellationReason,
  type SubscriptionCancellationReason,
} from "@/utils/subscription-cancellation";

type CancelBody = {
  reason?: string;
  reason_detail?: string | null;
  workspace_name_confirmation?: string;
};

type SubscriptionRow = {
  id: string;
  subscription_status: string;
  paystack_subscription_id: string | null;
  paystack_email_token: string | null;
  next_billing_date: string | null;
  billing_waived: boolean | null;
  cancelled_at: string | null;
};

export async function POST(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CancelBody;
  try {
    body = (await request.json()) as CancelBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const reason = body.reason?.trim() ?? "";
  if (!isSubscriptionCancellationReason(reason)) {
    return NextResponse.json(
      { error: "A valid cancellation reason is required." },
      { status: 400 },
    );
  }

  const reasonDetail = body.reason_detail?.trim() ?? "";
  if (reason === "other" && !reasonDetail) {
    return NextResponse.json(
      { error: "Please describe your reason when selecting Other." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const [{ data: tenant, error: tenantError }, { data: sub, error: subError }] =
    await Promise.all([
      admin
        .from("tenants")
        .select("id, name")
        .eq("id", auth.tenantId)
        .maybeSingle(),
      admin
        .from("crm_subscriptions")
        .select(
          "id, subscription_status, paystack_subscription_id, paystack_email_token, next_billing_date, billing_waived, cancelled_at",
        )
        .eq("tenant_id", DAVORS_TENANT_ID)
        .eq("linked_tenant_id", auth.tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (tenantError) {
    return NextResponse.json({ error: tenantError.message }, { status: 400 });
  }
  if (subError) {
    return NextResponse.json({ error: subError.message }, { status: 400 });
  }
  if (!tenant?.name?.trim()) {
    return NextResponse.json(
      { error: "Workspace name could not be resolved." },
      { status: 400 },
    );
  }

  const workspaceName = tenant.name.trim();
  const confirmation = body.workspace_name_confirmation?.trim() ?? "";
  if (confirmation !== workspaceName) {
    return NextResponse.json(
      {
        error: `Type your workspace name exactly as shown (${workspaceName}) to confirm cancellation.`,
      },
      { status: 400 },
    );
  }

  const row = sub as SubscriptionRow | null;
  if (!row) {
    return NextResponse.json(
      { error: "No subscription record found for this workspace." },
      { status: 404 },
    );
  }

  if (row.billing_waived === true) {
    return NextResponse.json(
      { error: "This workspace has a billing waiver. Contact Davors support." },
      { status: 403 },
    );
  }

  if (row.subscription_status === "cancelled" && row.cancelled_at) {
    return NextResponse.json(
      {
        error: "Subscription is already cancelled.",
        access_until: row.next_billing_date,
      },
      { status: 409 },
    );
  }

  if (
    row.subscription_status !== "active" &&
    row.subscription_status !== "past_due"
  ) {
    return NextResponse.json(
      {
        error:
          "Only an active or past-due paid subscription can be cancelled here. Contact support if you need help.",
      },
      { status: 400 },
    );
  }

  const subscriptionCode = row.paystack_subscription_id?.trim() ?? "";
  if (!subscriptionCode) {
    return NextResponse.json(
      {
        error:
          "No Paystack subscription is linked yet. Complete checkout before cancelling.",
      },
      { status: 400 },
    );
  }

  let emailToken = row.paystack_email_token?.trim() ?? "";
  if (!emailToken) {
    const fetched = await fetchPaystackSubscription(subscriptionCode);
    if (!fetched.ok) {
      return NextResponse.json({ error: fetched.error }, { status: 502 });
    }
    emailToken = fetched.subscription.emailToken?.trim() ?? "";
  }

  if (!emailToken) {
    return NextResponse.json(
      {
        error:
          "Paystack did not return an email token for this subscription. Contact support to complete cancellation.",
      },
      { status: 502 },
    );
  }

  const disabled = await disablePaystackSubscription({
    subscriptionCode,
    emailToken,
  });
  if (!disabled.ok) {
    return NextResponse.json({ error: disabled.error }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    subscription_status: "cancelled",
    cancellation_reason: reason satisfies SubscriptionCancellationReason,
    cancellation_reason_detail: reason === "other" ? reasonDetail : null,
    cancelled_at: nowIso,
    paystack_email_token: emailToken,
  };

  const { error: updateError } = await admin
    .from("crm_subscriptions")
    .update(patch)
    .eq("id", row.id)
    .eq("tenant_id", DAVORS_TENANT_ID);

  if (updateError) {
    return NextResponse.json(
      {
        error: `Paystack cancelled the subscription but we failed to save status: ${updateError.message}. Refresh shortly — the webhook may still apply it.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    subscription_status: "cancelled",
    access_until: row.next_billing_date,
    cancelled_at: nowIso,
  });
}
