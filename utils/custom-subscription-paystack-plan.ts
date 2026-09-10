import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPaystackPlan,
  ghsToPesewas,
  updatePaystackPlanAmount,
} from "@/utils/paystack";
import { roundGhs } from "@/utils/product-sale-paystack";

const PAYSTACK_INTERVALS = new Set([
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "biannually",
  "annually",
]);

export function billingCycleToPaystackInterval(
  billingCycle: string | null | undefined,
): string {
  const normalized = (billingCycle ?? "").trim().toLowerCase();
  if (normalized === "yearly") {
    return "annually";
  }
  if (normalized === "monthly" || normalized === "quarterly") {
    return normalized;
  }
  if (PAYSTACK_INTERVALS.has(normalized)) {
    return normalized;
  }
  return "monthly";
}

export function formatBillingCycleLabel(
  billingCycle: string | null | undefined,
): string {
  const normalized = (billingCycle ?? "").trim().toLowerCase();
  switch (normalized) {
    case "monthly":
      return "Monthly";
    case "yearly":
      return "Yearly";
    case "quarterly":
      return "Quarterly";
    case "biannually":
      return "Biannually";
    case "annually":
      return "Annually";
    case "weekly":
      return "Weekly";
    case "daily":
      return "Daily";
    default:
      return "Monthly";
  }
}

export function buildCustomSubscriptionPlanName(input: {
  tenantName: string;
  customPriceGhs: number;
  billingCycleLabel: string;
}): string {
  const tenantName = input.tenantName.trim() || "Tenant";
  const amountLabel = roundGhs(input.customPriceGhs).toFixed(2);
  return `Custom - ${tenantName}, GHS ${amountLabel}/${input.billingCycleLabel}`;
}

export async function syncCustomSubscriptionPaystackPlan(
  admin: SupabaseClient,
  input: {
    subscriptionId: string;
    linkedTenantId: string;
    customPriceGhs: number;
    existingPlanCode: string | null;
    productId: string | null;
  },
): Promise<{ ok: true; planCode: string } | { ok: false; error: string }> {
  const customPriceGhs = roundGhs(input.customPriceGhs);
  if (!Number.isFinite(customPriceGhs) || customPriceGhs <= 0) {
    return { ok: false, error: "Custom price must be a positive number." };
  }

  if (!input.productId) {
    return {
      ok: false,
      error:
        "Assign a subscription tier to this tenant before setting a custom price (needed for billing cycle).",
    };
  }

  const [{ data: tenant, error: tenantError }, { data: product, error: productError }] =
    await Promise.all([
      admin.from("tenants").select("name").eq("id", input.linkedTenantId).maybeSingle(),
      admin
        .from("crm_products")
        .select("billing_cycle")
        .eq("id", input.productId)
        .maybeSingle(),
    ]);

  if (tenantError) {
    return { ok: false, error: tenantError.message };
  }
  if (productError) {
    return { ok: false, error: productError.message };
  }
  if (!product) {
    return { ok: false, error: "Subscription tier not found for billing cycle." };
  }

  const billingCycleLabel = formatBillingCycleLabel(product.billing_cycle);
  const paystackInterval = billingCycleToPaystackInterval(product.billing_cycle);
  const amountPesewas = ghsToPesewas(customPriceGhs);
  const existingPlanCode = input.existingPlanCode?.trim() ?? "";

  if (existingPlanCode) {
    const updated = await updatePaystackPlanAmount({
      planCode: existingPlanCode,
      amountPesewas,
      currency: "GHS",
    });
    if (!updated.ok) {
      return updated;
    }
    return { ok: true, planCode: existingPlanCode };
  }

  const created = await createPaystackPlan({
    name: buildCustomSubscriptionPlanName({
      tenantName: tenant?.name ?? "Tenant",
      customPriceGhs,
      billingCycleLabel,
    }),
    amountPesewas,
    interval: paystackInterval,
    currency: "GHS",
  });

  if (!created.ok) {
    return created;
  }

  const { error: updateError } = await admin
    .from("crm_subscriptions")
    .update({ custom_price_paystack_plan_code: created.planCode })
    .eq("id", input.subscriptionId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true, planCode: created.planCode };
}
