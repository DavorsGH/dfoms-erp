import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { validateAdminCustomerTenantId } from "@/utils/admin-tenant-api";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { CUSTOM_PRICE_OVERRIDE_CLEAR_FIELDS } from "@/utils/custom-subscription-price-tier-lock";
import { syncCustomSubscriptionPaystackPlan } from "@/utils/custom-subscription-paystack-plan";
import { isValidUuid } from "@/utils/uuid-validation";

type CustomPriceBody = {
  tenant_id?: string;
  custom_price_ghs?: number | null;
  custom_price_reason?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CustomPriceBody;
  try {
    body = (await request.json()) as CustomPriceBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tenantValidation = validateAdminCustomerTenantId(body.tenant_id);
  if (!tenantValidation.ok) {
    return tenantValidation.response;
  }
  const tenantId = tenantValidation.tenantId;

  const admin = createAdminClient();

  const { data: subscription, error: subscriptionError } = await admin
    .from("crm_subscriptions")
    .select("id, product_id, custom_price_paystack_plan_code")
    .eq("linked_tenant_id", tenantId)
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

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const setBy = user?.id?.trim() ?? "";
  if (!isValidUuid(setBy)) {
    return NextResponse.json(
      { error: "Unable to resolve the signed-in admin user id." },
      { status: 400 },
    );
  }

  const clearing =
    body.custom_price_ghs === null ||
    body.custom_price_ghs === undefined ||
    (typeof body.custom_price_ghs === "number" && body.custom_price_ghs <= 0);

  if (clearing) {
    const { error: updateError } = await admin
      .from("crm_subscriptions")
      .update(CUSTOM_PRICE_OVERRIDE_CLEAR_FIELDS)
      .eq("id", subscription.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, cleared: true });
  }

  const customPriceGhs = Number(body.custom_price_ghs);
  const reason =
    typeof body.custom_price_reason === "string"
      ? body.custom_price_reason.trim()
      : "";

  if (!Number.isFinite(customPriceGhs) || customPriceGhs <= 0) {
    return NextResponse.json(
      { error: "custom_price_ghs must be a positive number." },
      { status: 400 },
    );
  }

  if (!reason) {
    return NextResponse.json(
      { error: "custom_price_reason is required when setting a custom price." },
      { status: 400 },
    );
  }

  if (!subscription.product_id) {
    return NextResponse.json(
      {
        error:
          "Assign a subscription tier to this tenant before setting a custom price.",
      },
      { status: 400 },
    );
  }

  const paystackPlan = await syncCustomSubscriptionPaystackPlan(admin, {
    subscriptionId: subscription.id,
    linkedTenantId: tenantId,
    customPriceGhs,
    existingPlanCode: subscription.custom_price_paystack_plan_code,
    productId: subscription.product_id,
  });

  if (!paystackPlan.ok) {
    return NextResponse.json({ error: paystackPlan.error }, { status: 400 });
  }

  const { error: updateError } = await admin
    .from("crm_subscriptions")
    .update({
      custom_price_ghs: customPriceGhs,
      custom_price_reason: reason,
      custom_price_set_by: setBy,
      custom_price_set_at: new Date().toISOString(),
      custom_price_paystack_plan_code: paystackPlan.planCode,
      custom_price_tier_product_id: subscription.product_id,
    })
    .eq("id", subscription.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    custom_price_ghs: customPriceGhs,
    custom_price_reason: reason,
    custom_price_set_by: setBy,
    custom_price_set_at: new Date().toISOString(),
    custom_price_paystack_plan_code: paystackPlan.planCode,
    custom_price_tier_product_id: subscription.product_id,
  });
}
