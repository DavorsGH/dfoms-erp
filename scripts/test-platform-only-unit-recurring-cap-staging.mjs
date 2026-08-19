/**
 * Staging: dry-run platform_only recurring unit billing cap math for one landlord.
 *
 * Uses the same shared recurring billing path as the monthly and annual crons,
 * but never calls Paystack or writes audit rows.
 *
 * Usage:
 *   node scripts/test-platform-only-unit-recurring-cap-staging.mjs <tenant_id>
 *   node scripts/test-platform-only-unit-recurring-cap-staging.mjs <tenant_id> --env-file .env.staging.local
 *   node scripts/test-platform-only-unit-recurring-cap-staging.mjs <tenant_id> --billing-month 2026-08
 *   node scripts/test-platform-only-unit-recurring-cap-staging.mjs <tenant_id> --as-of-date 2026-08-19
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_SUPABASE_HOST = "wieflwbfdmjtsdnwbfii";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
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
  if (request === "@/utils/paystack" || String(request).endsWith("/paystack")) {
    return {
      chargePaystackAuthorization: async () => {
        throw new Error("Paystack must not be called from this staging dry-run script.");
      },
      ghsToPesewas: (ghs) => Math.round(Number(ghs) * 100),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const positionals = argv.filter((arg) => !arg.startsWith("--"));
  const envFileIdx = argv.indexOf("--env-file");
  const billingMonthIdx = argv.indexOf("--billing-month");
  const asOfDateIdx = argv.indexOf("--as-of-date");

  return {
    tenantId: positionals[0]?.trim() ?? "",
    envFile:
      envFileIdx >= 0 && argv[envFileIdx + 1]
        ? argv[envFileIdx + 1]
        : ".env.staging.local",
    billingMonth:
      billingMonthIdx >= 0 && argv[billingMonthIdx + 1]
        ? argv[billingMonthIdx + 1].trim()
        : undefined,
    asOfDate:
      asOfDateIdx >= 0 && argv[asOfDateIdx + 1]
        ? argv[asOfDateIdx + 1].trim()
        : undefined,
    dryRun: !flags.has("--live"),
  };
}

function printUsage() {
  console.log(`Usage:
  node scripts/test-platform-only-unit-recurring-cap-staging.mjs <tenant_id> [options]

Options:
  --env-file <path>       Default: .env.staging.local
  --billing-month YYYY-MM Override monthly period (monthly landlords only)
  --as-of-date YYYY-MM-DD Override annual period start (annual landlords only)

This script always dry-runs (no Paystack, no audit writes).`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.tenantId) {
  printUsage();
  process.exit(1);
}

assert(args.dryRun, "Live billing is disabled in this script.");

loadEnvForce(resolve(process.cwd(), args.envFile));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
assert(supabaseUrl.includes(STAGING_SUPABASE_HOST), "Refusing non-staging Supabase URL.");
assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY.");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const {
  runPlatformOnlyLandlordMonthlyRecurringBillingForTenant,
} = await import("../utils/platform-only-unit-monthly-billing");
const {
  runPlatformOnlyLandlordAnnualRecurringBillingForTenant,
} = await import("../utils/platform-only-unit-annual-billing");

const { data: landlord, error: landlordError } = await admin
  .from("landlords")
  .select("tenant_id, landlord_type, approval_status")
  .eq("tenant_id", args.tenantId)
  .maybeSingle();
assert(!landlordError, landlordError?.message ?? "landlord lookup failed");
assert(landlord, "Landlord not found.");
assert(
  landlord.landlord_type === "platform_only",
  `Expected platform_only landlord, got ${landlord.landlord_type ?? "unknown"}.`,
);

const { data: subscription, error: subscriptionError } = await admin
  .from("landlord_subscriptions")
  .select("billing_cycle, status, trial_ends_at, current_period_end")
  .eq("tenant_id", args.tenantId)
  .maybeSingle();
assert(!subscriptionError, subscriptionError?.message ?? "subscription lookup failed");
assert(subscription, "landlord_subscriptions row not found.");

const billingCycle =
  subscription.billing_cycle === "annual" ? "annual" : "monthly";

console.log(`Env file: ${args.envFile}`);
console.log(`Landlord tenant_id: ${args.tenantId}`);
console.log(`Landlord type: ${landlord.landlord_type}`);
console.log(`Approval status: ${landlord.approval_status ?? "unknown"}`);
console.log(`Billing cycle: ${billingCycle}`);
console.log(`Subscription status: ${subscription.status ?? "unknown"}`);
if (subscription.trial_ends_at) {
  console.log(`Trial ends at: ${String(subscription.trial_ends_at).slice(0, 10)}`);
}
if (subscription.current_period_end) {
  console.log(
    `Current period end: ${String(subscription.current_period_end).slice(0, 10)}`,
  );
}
console.log("Mode: dry-run (Paystack and audit writes disabled)\n");

const detail =
  billingCycle === "annual"
    ? await runPlatformOnlyLandlordAnnualRecurringBillingForTenant(
        admin,
        args.tenantId,
        { asOfDate: args.asOfDate, dryRun: true },
      )
    : await runPlatformOnlyLandlordMonthlyRecurringBillingForTenant(
        admin,
        args.tenantId,
        { billingMonth: args.billingMonth, dryRun: true },
      );

const triggerType =
  billingCycle === "annual" ? "annual_recurring" : "monthly_recurring";

console.log("--- Recurring billing dry-run result ---");
console.log(`Tenant name: ${detail.tenantName}`);
console.log(`Trigger type: ${triggerType}`);
console.log(`Active unit count: ${detail.activeUnitCount}`);
console.log(`Platform unit cap: ${detail.unitCap ?? "unknown"}`);
console.log(`Billable unit count (MIN(active, cap)): ${detail.billableUnitCount ?? "unknown"}`);
console.log(
  `Unit rate (GHS/${billingCycle === "annual" ? "year" : "month"}): ${Number(detail.unitPriceGhs ?? 0).toFixed(2)}`,
);
console.log(`Charge amount (GHS): ${Number(detail.amountGhs).toFixed(2)}`);
console.log(`Paystack reference (would use): ${detail.reference ?? "—"}`);
console.log(`Outcome: ${detail.outcome}`);
if (detail.message) {
  console.log(`Note: ${detail.message}`);
}
console.log(`Dry run flag: ${detail.dryRun === true ? "yes" : "no"}`);

if (detail.billableUnitCount != null && detail.unitPriceGhs != null) {
  const expected = Math.round(detail.billableUnitCount * detail.unitPriceGhs * 100) / 100;
  assert(
    Math.abs(expected - detail.amountGhs) < 0.01,
    `Amount mismatch: expected ${expected}, got ${detail.amountGhs}`,
  );
  console.log(
    `\nCap math check: ${detail.billableUnitCount} × ${detail.unitPriceGhs.toFixed(2)} = ${expected.toFixed(2)} GHS`,
  );
}

console.log("\nDone — no Paystack charge attempted, no audit rows written.");
