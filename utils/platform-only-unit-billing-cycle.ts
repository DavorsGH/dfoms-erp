import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlatformOnlyLandlordInTrial } from "@/utils/platform-only-unit-billing";
import { chargePlatformOnlyLandlordAnnualCycleNow } from "@/utils/platform-only-unit-annual-billing";
import {
  buildAnnualPeriodBounds,
  countActiveBillingUnits,
  todayIsoDate,
} from "@/utils/platform-only-unit-recurring-billing";

export type BillingCycleSwitchTarget = "monthly" | "annual";

export type BillingCycleSwitchResult =
  | {
      ok: true;
      billingCycle: BillingCycleSwitchTarget;
      pendingBillingCycle: BillingCycleSwitchTarget | null;
      effectiveDate: string | null;
      charged: boolean;
      amountGhs: number | null;
      reference: string | null;
      message: string;
    }
  | { ok: false; error: string; status: number };

type SubscriptionRow = {
  tenant_id: string;
  billing_cycle: string | null;
  pending_billing_cycle: string | null;
  current_period_end: string | null;
  status: string | null;
};

async function loadSubscription(
  admin: SupabaseClient,
  tenantId: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await admin
    .from("landlord_subscriptions")
    .select(
      "tenant_id, billing_cycle, pending_billing_cycle, current_period_end, status",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SubscriptionRow | null) ?? null;
}

export async function switchPlatformOnlyLandlordBillingCycle(
  admin: SupabaseClient,
  tenantId: string,
  targetCycle: BillingCycleSwitchTarget,
): Promise<BillingCycleSwitchResult> {
  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("landlord_type, approval_status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (landlordError || !landlord) {
    return { ok: false, error: "Landlord not found.", status: 404 };
  }

  if (landlord.landlord_type !== "platform_only") {
    return {
      ok: false,
      error: "Billing cycle switches are only for platform-only landlords.",
      status: 403,
    };
  }

  if (landlord.approval_status !== "approved") {
    return {
      ok: false,
      error: "Your workspace must be approved before changing billing cycle.",
      status: 403,
    };
  }

  let subscription = await loadSubscription(admin, tenantId);
  if (!subscription) {
    return {
      ok: false,
      error: "No subscription record found. Contact support.",
      status: 404,
    };
  }

  const currentCycle =
    subscription.billing_cycle === "annual" ? "annual" : "monthly";
  const inTrial = await isPlatformOnlyLandlordInTrial(admin, tenantId);
  const nowIso = new Date().toISOString();

  if (targetCycle === "annual") {
    if (currentCycle === "annual" && !subscription.pending_billing_cycle) {
      return {
        ok: false,
        error: "You are already on annual billing.",
        status: 409,
      };
    }

    if (inTrial) {
      const { error } = await admin
        .from("landlord_subscriptions")
        .update({
          billing_cycle: "annual",
          pending_billing_cycle: null,
          updated_at: nowIso,
        })
        .eq("tenant_id", tenantId);

      if (error) {
        return { ok: false, error: error.message, status: 400 };
      }

      return {
        ok: true,
        billingCycle: "annual",
        pendingBillingCycle: null,
        effectiveDate: null,
        charged: false,
        amountGhs: null,
        reference: null,
        message:
          "Switched to annual billing. Your first annual charge runs after your trial ends.",
      };
    }

    const activeUnitCount = await countActiveBillingUnits(admin, tenantId);
    if (activeUnitCount <= 0) {
      return {
        ok: false,
        error: "Activate at least one unit before switching to annual billing.",
        status: 400,
      };
    }

    const chargeResult = await chargePlatformOnlyLandlordAnnualCycleNow(
      admin,
      tenantId,
    );

    if (chargeResult.outcome === "failed" || chargeResult.outcome === "error") {
      return {
        ok: false,
        error:
          chargeResult.message ??
          "Annual billing charge failed. Check your saved payment method.",
        status: 402,
      };
    }

    if (chargeResult.outcome !== "charged") {
      return {
        ok: false,
        error: `Unable to complete annual switch (${chargeResult.outcome}).`,
        status: 409,
      };
    }

    return {
      ok: true,
      billingCycle: "annual",
      pendingBillingCycle: null,
      effectiveDate: buildAnnualPeriodBounds(todayIsoDate()).periodStart,
      charged: true,
      amountGhs: chargeResult.amountGhs,
      reference: chargeResult.reference,
      message: `Annual billing activated. GHS ${chargeResult.amountGhs.toFixed(2)} charged for ${activeUnitCount} active unit${activeUnitCount === 1 ? "" : "s"}.`,
    };
  }

  if (currentCycle === "monthly" && !subscription.pending_billing_cycle) {
    if (inTrial) {
      const { error } = await admin
        .from("landlord_subscriptions")
        .update({
          billing_cycle: "monthly",
          pending_billing_cycle: null,
          updated_at: nowIso,
        })
        .eq("tenant_id", tenantId);

      if (error) {
        return { ok: false, error: error.message, status: 400 };
      }

      return {
        ok: true,
        billingCycle: "monthly",
        pendingBillingCycle: null,
        effectiveDate: null,
        charged: false,
        amountGhs: null,
        reference: null,
        message: "You are already on monthly billing.",
      };
    }

    return {
      ok: false,
      error: "You are already on monthly billing.",
      status: 409,
    };
  }

  if (inTrial) {
    const { error } = await admin
      .from("landlord_subscriptions")
      .update({
        billing_cycle: "monthly",
        pending_billing_cycle: null,
        updated_at: nowIso,
      })
      .eq("tenant_id", tenantId);

    if (error) {
      return { ok: false, error: error.message, status: 400 };
    }

    return {
      ok: true,
      billingCycle: "monthly",
      pendingBillingCycle: null,
      effectiveDate: null,
      charged: false,
      amountGhs: null,
      reference: null,
      message:
        "Switched to monthly billing. Your first monthly charge runs after your trial ends.",
    };
  }

  const periodEnd =
    typeof subscription.current_period_end === "string"
      ? subscription.current_period_end.slice(0, 10)
      : null;

  if (!periodEnd) {
    const { error } = await admin
      .from("landlord_subscriptions")
      .update({
        billing_cycle: "monthly",
        pending_billing_cycle: null,
        updated_at: nowIso,
      })
      .eq("tenant_id", tenantId);

    if (error) {
      return { ok: false, error: error.message, status: 400 };
    }

    return {
      ok: true,
      billingCycle: "monthly",
      pendingBillingCycle: null,
      effectiveDate: null,
      charged: false,
      amountGhs: null,
      reference: null,
      message: "Switched to monthly billing.",
    };
  }

  const { error } = await admin
    .from("landlord_subscriptions")
    .update({
      pending_billing_cycle: "monthly",
      updated_at: nowIso,
    })
    .eq("tenant_id", tenantId);

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }

  return {
    ok: true,
    billingCycle: "annual",
    pendingBillingCycle: "monthly",
    effectiveDate: periodEnd,
    charged: false,
    amountGhs: null,
    reference: null,
    message: `Switch to monthly billing scheduled for ${periodEnd}. No charge until your prepaid annual period ends.`,
  };
}
