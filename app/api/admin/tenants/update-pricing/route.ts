import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  ghsToPesewas,
  updatePaystackPlanAmount,
} from "@/utils/paystack";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

type UpdatePricingBody = {
  id?: string;
  unit_price?: number;
  price_ghs?: number;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdatePricingBody;
  try {
    body = (await request.json()) as UpdatePricingBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id, unit_price, price_ghs } = body;

  if (!id || typeof unit_price !== "number" || typeof price_ghs !== "number") {
    return NextResponse.json(
      { error: "id, unit_price, and price_ghs are required" },
      { status: 400 },
    );
  }

  if (unit_price < 0 || price_ghs < 0) {
    return NextResponse.json(
      { error: "Prices cannot be negative" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: product, error: fetchError } = await admin
    .from("crm_products")
    .select("id, name, price_ghs, paystack_plan_code")
    .eq("id", id)
    .eq("tenant_id", DAVORS_TENANT_ID)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!product) {
    return NextResponse.json({ error: "Pricing tier not found." }, { status: 404 });
  }

  const { error: updateError } = await admin
    .from("crm_products")
    .update({ unit_price, price_ghs })
    .eq("id", id)
    .eq("tenant_id", DAVORS_TENANT_ID);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const planCode =
    typeof product.paystack_plan_code === "string"
      ? product.paystack_plan_code.trim()
      : "";

  // Only push to Paystack when GHS amount actually changes (or was null).
  const previousGhs =
    product.price_ghs == null ? null : Number(product.price_ghs);
  const ghsChanged =
    previousGhs === null ||
    !Number.isFinite(previousGhs) ||
    previousGhs !== price_ghs;

  if (!ghsChanged) {
    return NextResponse.json({
      success: true,
      paystack_synced: false,
      paystack_skipped: "price_ghs unchanged",
    });
  }

  if (!planCode) {
    console.warn(
      `[update-pricing] No paystack_plan_code for product ${id} (${product.name}) — DB saved, Paystack skipped.`,
    );
    return NextResponse.json({
      success: true,
      paystack_synced: false,
      warning:
        "Database price saved, but this tier has no Paystack plan code yet — Paystack was not updated.",
    });
  }

  const paystackResult = await updatePaystackPlanAmount({
    planCode,
    amountPesewas: ghsToPesewas(price_ghs),
    currency: "GHS",
  });

  if (!paystackResult.ok) {
    console.error(
      `[update-pricing] Paystack sync failed for ${planCode}: ${paystackResult.error}`,
    );
    return NextResponse.json({
      success: true,
      paystack_synced: false,
      warning: `Database price saved, but Paystack plan sync failed: ${paystackResult.error}`,
    });
  }

  return NextResponse.json({
    success: true,
    paystack_synced: true,
    paystack_plan_code: planCode,
  });
}
