import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  ghsToPesewas,
  initializePaystackTransaction,
} from "@/utils/paystack";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import { ERP_SUITE_CATEGORY } from "@/app/dashboard/crm/products/products-utils";

type InitializeBody = {
  product_id?: string;
};

function resolveSiteUrl(request: Request): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  if (configured) {
    return configured;
  }

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  if (host) {
    return `${proto}://${host}`;
  }

  return "http://localhost:3000";
}

export async function POST(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: InitializeBody;
  try {
    body = (await request.json()) as InitializeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const productId = typeof body.product_id === "string" ? body.product_id.trim() : "";
  if (!productId) {
    return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Re-confirm tenant exists and load account email via service role.
  const [
    { data: tenant },
    { data: accountRow },
    { data: product, error: productError },
    { data: billingSettings },
  ] = await Promise.all([
    admin.from("tenants").select("id").eq("id", auth.tenantId).maybeSingle(),
    admin
      .from("user_accounts")
      .select("email, tenant_id")
      .eq("auth_uid", user.id)
      .maybeSingle(),
    admin
      .from("crm_products")
      .select(
        "id, name, price_ghs, unit_price, billing_cycle, paystack_plan_code, is_active, category",
      )
      .eq("id", productId)
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("category", ERP_SUITE_CATEGORY)
      .maybeSingle(),
    admin
      .from("billing_settings")
      .select("email_recipient")
      .eq("tenant_id", auth.tenantId)
      .maybeSingle(),
  ]);

  if (!tenant?.id) {
    return NextResponse.json(
      { error: "Authenticated tenant could not be resolved." },
      { status: 400 },
    );
  }

  // Defense in depth: account row must still point at the same tenant.
  if (accountRow?.tenant_id && accountRow.tenant_id !== auth.tenantId) {
    console.error(
      `[checkout/initialize] tenant mismatch auth=${auth.tenantId} account=${accountRow.tenant_id} user=${user?.id}`,
    );
    return NextResponse.json(
      { error: "Tenant resolution mismatch. Sign out and sign in again." },
      { status: 409 },
    );
  }

  const tenantId = tenant.id;

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 400 });
  }

  if (!product || product.is_active === false) {
    return NextResponse.json(
      { error: "Selected subscription tier is not available." },
      { status: 404 },
    );
  }

  const planCode =
    typeof product.paystack_plan_code === "string"
      ? product.paystack_plan_code.trim()
      : "";
  if (!planCode) {
    return NextResponse.json(
      {
        error:
          "This tier is not linked to a Paystack plan yet. Contact Davors support.",
      },
      { status: 400 },
    );
  }

  const priceGhs = Number(product.price_ghs);
  if (!Number.isFinite(priceGhs) || priceGhs <= 0) {
    return NextResponse.json(
      { error: "This tier does not have a valid GHS price configured." },
      { status: 400 },
    );
  }

  const billingEmail =
    (typeof billingSettings?.email_recipient === "string"
      ? billingSettings.email_recipient.trim()
      : "") ||
    (typeof accountRow?.email === "string" ? accountRow.email.trim() : "") ||
    (user?.email ?? "").trim();

  if (!billingEmail) {
    return NextResponse.json(
      {
        error:
          "Set a billing email recipient in Billing Settings (or ensure your account has an email) before checking out.",
      },
      { status: 400 },
    );
  }

  const callbackUrl = `${resolveSiteUrl(request)}/dashboard/administration/billing/callback`;

  const initialized = await initializePaystackTransaction({
    email: billingEmail,
    planCode,
    amountPesewas: ghsToPesewas(priceGhs),
    callbackUrl,
    currency: "GHS",
    metadata: {
      tenant_id: tenantId,
      product_id: product.id,
      product_name: product.name,
      billing_cycle: product.billing_cycle,
    },
  });

  if (!initialized.ok) {
    return NextResponse.json({ error: initialized.error }, { status: 502 });
  }

  return NextResponse.json({
    authorization_url: initialized.authorizationUrl,
    access_code: initialized.accessCode,
    reference: initialized.reference,
    email: billingEmail,
    tenant_id: tenantId,
    plan_code: planCode,
    product_name: product.name,
  });
}
