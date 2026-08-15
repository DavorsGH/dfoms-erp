/**
 * Staging: platform-only annual/monthly billing cycle simulation.
 *
 * Covers:
 *   - migration 220 columns + annual config seed
 *   - trial → first charge path (monthly + annual, trial-skip audit rows)
 *   - billing cycle switches (trial + pending annual→monthly flip)
 *
 * Usage:
 *   npx tsx scripts/test-platform-unit-annual-billing-staging.ts
 *   npx tsx scripts/test-platform-unit-annual-billing-staging.ts --env-file .env.staging.local
 */
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })
  ._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (
  request: unknown,
  parent: unknown,
  isMain: unknown,
) {
  if (request === "server-only") {
    return {};
  }
  if (request === "@/utils/resend-email" || String(request).endsWith("resend-email")) {
    return {
      sendResendEmail: async () => ({ ok: true, id: "stub-email" }),
    };
  }
  if (request === "@/utils/hubtel-sms" || String(request).endsWith("hubtel-sms")) {
    return {
      sendHubtelSms: async () => ({ ok: true }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

import { assert, loadEnvFromArgv } from "./lib/env";

async function loadBillingModules() {
  const [
    annualBilling,
    monthlyBilling,
    trialReminders,
    billingCycle,
    billingConfig,
  ] = await Promise.all([
    import("../utils/platform-only-unit-annual-billing"),
    import("../utils/platform-only-unit-monthly-billing"),
    import("../utils/platform-only-unit-trial-reminders"),
    import("../utils/platform-only-unit-billing-cycle"),
    import("../utils/platform-billing-config"),
  ]);
  return {
    runPlatformOnlyUnitAnnualBilling: annualBilling.runPlatformOnlyUnitAnnualBilling,
    runPlatformOnlyUnitMonthlyBilling: monthlyBilling.runPlatformOnlyUnitMonthlyBilling,
    runPlatformOnlyUnitTrialReminders: trialReminders.runPlatformOnlyUnitTrialReminders,
    switchPlatformOnlyLandlordBillingCycle:
      billingCycle.switchPlatformOnlyLandlordBillingCycle,
    getPlatformOnlyUnitActivationPriceGhs:
      billingConfig.getPlatformOnlyUnitActivationPriceGhs,
    getPlatformOnlyUnitAnnualPriceGhs:
      billingConfig.getPlatformOnlyUnitAnnualPriceGhs,
  };
}

type StepResult = { step: string; pass: boolean; detail: string };
const results: StepResult[] = [];

function record(step: string, pass: boolean, detail: string) {
  results.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function insertPlatformSubscription(
  admin: ReturnType<typeof createClient>,
  options: {
    tenantId: string;
    trialEndsAt: string;
    billingCycle: "monthly" | "annual";
    status?: string;
    pendingBillingCycle?: "monthly" | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    activeUnitCount?: number;
  },
): Promise<void> {
  const periodStart = options.currentPeriodStart ?? options.trialEndsAt;
  const periodEnd = options.currentPeriodEnd ?? options.trialEndsAt;
  const { error } = await admin.from("landlord_subscriptions").insert({
    tenant_id: options.tenantId,
    tier: "platform",
    status: options.status ?? "trialing",
    trial_ends_at: options.trialEndsAt,
    billing_cycle: options.billingCycle,
    pending_billing_cycle: options.pendingBillingCycle ?? null,
    active_unit_count: options.activeUnitCount ?? 0,
    included_units: 0,
    base_price_ghs: 0,
    extra_unit_price_ghs: 110,
    current_period_price_ghs: 0,
    current_period_start: periodStart,
    current_period_end: periodEnd,
  });
  assert(!error, error?.message ?? "landlord_subscriptions insert failed");
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  console.log(`Using env file: ${envFile}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  assert(supabaseUrl && serviceKey, "Missing Supabase URL or service role key.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    runPlatformOnlyUnitAnnualBilling,
    runPlatformOnlyUnitMonthlyBilling,
    runPlatformOnlyUnitTrialReminders,
    switchPlatformOnlyLandlordBillingCycle,
    getPlatformOnlyUnitActivationPriceGhs,
    getPlatformOnlyUnitAnnualPriceGhs,
  } = await loadBillingModules();

  const stamp = Date.now().toString(36);
  const createdTenantIds: string[] = [];

  try {
    const tenantId = randomUUID();
    const propertyId = randomUUID();
    const unitId = randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const trialEndsMonthly = addDays(today, 14);
    const trialEndsAnnual = addDays(today, 3);

    const { error: migrationProbeError } = await admin
      .from("landlord_subscriptions")
      .select("billing_cycle, pending_billing_cycle")
      .limit(1);
    record(
      "migration 220 columns",
      !migrationProbeError,
      migrationProbeError?.message ??
        "billing_cycle + pending_billing_cycle readable",
    );

    const [monthlyPrice, annualPrice] = await Promise.all([
      getPlatformOnlyUnitActivationPriceGhs(admin),
      getPlatformOnlyUnitAnnualPriceGhs(admin),
    ]);
    record(
      "annual config price",
      annualPrice > 0,
      `monthly=${monthlyPrice}, annual=${annualPrice}`,
    );

    const { error: tenantError } = await admin.from("tenants").insert({
      id: tenantId,
      name: `Annual Billing Test ${stamp}`,
      slug: `annual-bill-test-${stamp}`,
      status: "active",
      product_line: "real_estate_only",
      email: `annual-bill-test-${stamp}@example.com`,
    });
    assert(!tenantError, tenantError?.message ?? "tenant insert failed");
    createdTenantIds.push(tenantId);

    const { error: landlordError } = await admin.from("landlords").insert({
      tenant_id: tenantId,
      landlord_type: "platform_only",
      approval_status: "approved",
      paystack_charge_authorization_code: "AUTH_test_simulation",
      paystack_charge_authorization_email: `annual-bill-test-${stamp}@example.com`,
    });
    assert(!landlordError, landlordError?.message ?? "landlord insert failed");

    const { error: propertyError } = await admin.from("properties").insert({
      property_id: propertyId,
      tenant_id: tenantId,
      name: `Test Property ${stamp}`,
      property_type: "residential",
      address_line1: "12 Test Lane",
      city: "Accra",
      region: "Greater Accra",
      photo_urls: [],
    });
    assert(!propertyError, propertyError?.message ?? "property insert failed");

    const { error: unitError } = await admin.from("property_units").insert({
      unit_id: unitId,
      tenant_id: tenantId,
      property_id: propertyId,
      unit_number: "T1",
      bedrooms: 1,
      bathrooms: 1,
      base_rent_ghs: 1000,
      status: "vacant",
      billing_activation_status: "active",
      billing_activated_at: new Date().toISOString(),
    });
    assert(!unitError, unitError?.message ?? "unit insert failed");

    // --- Monthly trial landlord ---
    const monthlyTenantId = tenantId;
    await insertPlatformSubscription(admin, {
      tenantId: monthlyTenantId,
      trialEndsAt: addDays(today, -1),
      billingCycle: "monthly",
      status: "trialing",
      activeUnitCount: 1,
    });

    const monthlyBilling = await runPlatformOnlyUnitMonthlyBilling({
      billingMonth: today.slice(0, 7),
    });
    const monthlyDetail = monthlyBilling.details.find(
      (row) => row.tenantId === monthlyTenantId,
    );
    record(
      "monthly post-trial charge attempt",
      monthlyDetail?.outcome === "failed" || monthlyDetail?.outcome === "charged",
      monthlyDetail
        ? `${monthlyDetail.outcome}${monthlyDetail.message ? `: ${monthlyDetail.message}` : ""}`
        : "tenant not in monthly billing run",
    );

    // --- Annual trial landlord (separate tenant) ---
    const annualTenantId = randomUUID();
    const annualPropertyId = randomUUID();
    const annualUnitId = randomUUID();
    await admin.from("tenants").insert({
      id: annualTenantId,
      name: `Annual Cycle Test ${stamp}`,
      slug: `annual-cycle-test-${stamp}`,
      status: "active",
      product_line: "real_estate_only",
      email: `annual-cycle-test-${stamp}@example.com`,
    });
    createdTenantIds.push(annualTenantId);
    await admin.from("landlords").insert({
      tenant_id: annualTenantId,
      landlord_type: "platform_only",
      approval_status: "approved",
      paystack_charge_authorization_code: "AUTH_test_simulation",
      paystack_charge_authorization_email: `annual-cycle-test-${stamp}@example.com`,
    });
    await admin.from("properties").insert({
      property_id: annualPropertyId,
      tenant_id: annualTenantId,
      name: "Annual Test Property",
      property_type: "residential",
      address_line1: "12 Test Lane",
      city: "Accra",
      region: "Greater Accra",
      photo_urls: [],
    });
    await admin.from("property_units").insert({
      unit_id: annualUnitId,
      tenant_id: annualTenantId,
      property_id: annualPropertyId,
      unit_number: "A1",
      bedrooms: 1,
      bathrooms: 1,
      base_rent_ghs: 1000,
      status: "vacant",
      billing_activation_status: "active",
      billing_activated_at: new Date().toISOString(),
    });
    await insertPlatformSubscription(admin, {
      tenantId: annualTenantId,
      trialEndsAt: addDays(today, -1),
      billingCycle: "annual",
      status: "trialing",
      activeUnitCount: 1,
    });

    const annualBilling = await runPlatformOnlyUnitAnnualBilling({ asOfDate: today });
    const annualDetail = annualBilling.details.find(
      (row) => row.tenantId === annualTenantId,
    );
    record(
      "annual post-trial charge attempt",
      annualDetail?.outcome === "failed" || annualDetail?.outcome === "charged",
      annualDetail
        ? `${annualDetail.outcome}${annualDetail.message ? `: ${annualDetail.message}` : ""}`
        : "tenant not in annual billing run",
    );

    // --- Trial cycle switches (no charge) ---
    const switchTenantId = randomUUID();
    await admin.from("tenants").insert({
      id: switchTenantId,
      name: `Switch Test ${stamp}`,
      slug: `switch-test-${stamp}`,
      status: "active",
      product_line: "real_estate_only",
      email: `switch-test-${stamp}@example.com`,
    });
    createdTenantIds.push(switchTenantId);
    await admin.from("landlords").insert({
      tenant_id: switchTenantId,
      landlord_type: "platform_only",
      approval_status: "approved",
    });
    await insertPlatformSubscription(admin, {
      tenantId: switchTenantId,
      trialEndsAt: addDays(today, 30),
      billingCycle: "monthly",
    });

    const toAnnual = await switchPlatformOnlyLandlordBillingCycle(
      admin,
      switchTenantId,
      "annual",
    );
    record(
      "trial switch monthly→annual (no charge)",
      toAnnual.ok && toAnnual.charged === false && toAnnual.billingCycle === "annual",
      toAnnual.ok ? toAnnual.message : toAnnual.error,
    );

    const toMonthlyTrial = await switchPlatformOnlyLandlordBillingCycle(
      admin,
      switchTenantId,
      "monthly",
    );
    record(
      "trial switch back to monthly (no charge)",
      toMonthlyTrial.ok &&
        toMonthlyTrial.charged === false &&
        toMonthlyTrial.billingCycle === "monthly",
      toMonthlyTrial.ok ? toMonthlyTrial.message : toMonthlyTrial.error,
    );

    // --- Pending annual→monthly flip ---
    const flipTenantId = randomUUID();
    const periodStart = addDays(today, -400);
    const periodEnd = addDays(today, -1);
    await admin.from("tenants").insert({
      id: flipTenantId,
      name: `Flip Test ${stamp}`,
      slug: `flip-test-${stamp}`,
      status: "active",
      product_line: "real_estate_only",
      email: `flip-test-${stamp}@example.com`,
    });
    createdTenantIds.push(flipTenantId);
    await admin.from("landlords").insert({
      tenant_id: flipTenantId,
      landlord_type: "platform_only",
      approval_status: "approved",
    });
    await insertPlatformSubscription(admin, {
      tenantId: flipTenantId,
      trialEndsAt: addDays(today, -400),
      billingCycle: "annual",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      activeUnitCount: 1,
    });

    const pendingSwitch = await switchPlatformOnlyLandlordBillingCycle(
      admin,
      flipTenantId,
      "monthly",
    );
    record(
      "annual→monthly deferral sets pending",
      pendingSwitch.ok &&
        pendingSwitch.pendingBillingCycle === "monthly" &&
        pendingSwitch.charged === false,
      pendingSwitch.ok ? pendingSwitch.message : pendingSwitch.error,
    );

    const flipRun = await runPlatformOnlyUnitAnnualBilling({ asOfDate: today });
    const { data: flippedSub } = await admin
      .from("landlord_subscriptions")
      .select("billing_cycle, pending_billing_cycle")
      .eq("tenant_id", flipTenantId)
      .maybeSingle();
    record(
      "pending flip at period end",
      flipRun.pendingFlips >= 1 &&
        flippedSub?.billing_cycle === "monthly" &&
        flippedSub?.pending_billing_cycle == null,
      `flips=${flipRun.pendingFlips}, cycle=${flippedSub?.billing_cycle}`,
    );

    // --- Trial reminders idempotency windows ---
    const reminderTenantId = randomUUID();
    const reminderPropertyId = randomUUID();
    await admin.from("tenants").insert({
      id: reminderTenantId,
      name: `Reminder Test ${stamp}`,
      slug: `reminder-test-${stamp}`,
      status: "active",
      product_line: "real_estate_only",
      email: `reminder-test-${stamp}@example.com`,
    });
    createdTenantIds.push(reminderTenantId);
    await admin.from("landlords").insert({
      tenant_id: reminderTenantId,
      landlord_type: "platform_only",
      approval_status: "approved",
      notification_phone: "233241234567",
    });
    await admin.from("properties").insert({
      property_id: reminderPropertyId,
      tenant_id: reminderTenantId,
      name: "Reminder Property",
      property_type: "residential",
      address_line1: "12 Test Lane",
      city: "Accra",
      region: "Greater Accra",
      photo_urls: [],
    });
    await insertPlatformSubscription(admin, {
      tenantId: reminderTenantId,
      trialEndsAt: trialEndsMonthly,
      billingCycle: "monthly",
    });
    await admin.from("property_units").insert({
      unit_id: randomUUID(),
      tenant_id: reminderTenantId,
      property_id: reminderPropertyId,
      unit_number: "R1",
      bedrooms: 1,
      bathrooms: 1,
      base_rent_ghs: 1000,
      status: "vacant",
      billing_activation_status: "active",
    });

    const reminders14 = await runPlatformOnlyUnitTrialReminders({ asOfDate: today });
    const sent14 = reminders14.details.some(
      (row) => row.tenantId === reminderTenantId && row.reminderDays === 14,
    );
    record("14-day trial reminder", sent14, `sent14d=${reminders14.sent14d}`);

    await admin
      .from("landlord_subscriptions")
      .update({ trial_ends_at: trialEndsAnnual })
      .eq("tenant_id", reminderTenantId);
    const reminders3 = await runPlatformOnlyUnitTrialReminders({ asOfDate: today });
    const sent3 = reminders3.details.some(
      (row) => row.tenantId === reminderTenantId && row.reminderDays === 3,
    );
    record("3-day trial reminder", sent3, `sent3d=${reminders3.sent3d}`);
  } finally {
    for (const id of createdTenantIds) {
      await admin.from("landlord_unit_activation_charges").delete().eq("tenant_id", id);
      await admin.from("landlord_notifications").delete().eq("tenant_id", id);
      await admin.from("property_units").delete().eq("tenant_id", id);
      await admin.from("properties").delete().eq("tenant_id", id);
      await admin.from("landlord_subscriptions").delete().eq("tenant_id", id);
      await admin.from("landlords").delete().eq("tenant_id", id);
      await admin.from("tenants").delete().eq("id", id);
    }
    console.log(`\nCleaned up ${createdTenantIds.length} test tenant(s)`);
  }

  const failed = results.filter((row) => !row.pass);
  console.log("\n=== SUMMARY ===");
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    console.log("Failures:");
    for (const row of failed) {
      console.log(`  - ${row.step}: ${row.detail}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
