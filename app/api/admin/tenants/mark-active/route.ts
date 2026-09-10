import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { validateAdminCustomerTenantId } from "@/utils/admin-tenant-api";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import { parseRequiredUuid } from "@/utils/uuid-validation";

type MarkActiveBody = {
  tenant_id?: string;
  product_id?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: MarkActiveBody;
  try {
    body = (await request.json()) as MarkActiveBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { product_id } = body;

  const tenantValidation = validateAdminCustomerTenantId(body.tenant_id);
  if (!tenantValidation.ok) {
    return tenantValidation.response;
  }
  const tenant_id = tenantValidation.tenantId;

  const productValidation = parseRequiredUuid(product_id, "product_id");
  if (!productValidation.ok) {
    return NextResponse.json({ error: productValidation.message }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: product, error: productError } = await admin
    .from("crm_products")
    .select("id")
    .eq("id", productValidation.value)
    .eq("tenant_id", DAVORS_TENANT_ID)
    .maybeSingle();

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 400 });
  }

  if (!product) {
    return NextResponse.json({ error: "Selected tier not found." }, { status: 404 });
  }

  const { data: subscription, error: subscriptionError } = await admin
    .from("crm_subscriptions")
    .select("id, subscription_status")
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

  const isAlreadyActive = subscription.subscription_status === "active";

  const subscriptionUpdate: {
    product_id: string;
    subscription_status?: "active";
  } = { product_id: productValidation.value };

  if (!isAlreadyActive) {
    subscriptionUpdate.subscription_status = "active";
  }

  const { error: updateError } = await admin
    .from("crm_subscriptions")
    .update(subscriptionUpdate)
    .eq("id", subscription.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  if (!isAlreadyActive) {
    const { error: tenantUpdateError } = await admin
      .from("tenants")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", tenant_id);

    if (tenantUpdateError) {
      return NextResponse.json({ error: tenantUpdateError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true });
}
