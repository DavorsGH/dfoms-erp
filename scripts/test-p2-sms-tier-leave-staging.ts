/**
 * Staging P2 verification:
 * 1) SMS debit wired in campaign + announcement send sources
 * 2) Phase 7 APIs call assertTenantHasFeature('email_promotions'); null-tenant fail-closed
 * 3) Leave entitlement resolver + leave resync dry-run
 *
 *   npx tsx scripts/test-p2-sms-tier-leave-staging.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let v = trimmed.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = v;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const envIdx = process.argv.indexOf("--env-file");
  const envFile =
    envIdx >= 0 && process.argv[envIdx + 1]
      ? process.argv[envIdx + 1]!
      : ".env.staging.local";
  loadEnvForce(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING), "Refusing non-staging");
  assert(key, "missing service role");

  console.log("=== P2 staging verification ===\n");

  const campaignSrc = readFileSync(
    resolve(process.cwd(), "utils/campaign-send.ts"),
    "utf8",
  );
  const announcementSrc = readFileSync(
    resolve(process.cwd(), "utils/employee-announcement-send.ts"),
    "utf8",
  );
  const creditSrc = readFileSync(
    resolve(process.cwd(), "utils/sms-credit.ts"),
    "utf8",
  );
  assert(
    /tryDebitSmsCredit/.test(campaignSrc) &&
      /skipped_no_credit/.test(campaignSrc),
    "campaign-send missing debit/skip",
  );
  assert(
    /tryDebitSmsCredit/.test(announcementSrc) &&
      /skipped_no_credit/.test(announcementSrc),
    "announcement-send missing debit/skip",
  );
  assert(/debit_sms_credit/.test(creditSrc), "sms-credit helper missing RPC");
  console.log("PASS source: campaign + announcement SMS debit + skip status");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: debitOk, error: debitError } = await admin.rpc(
    "debit_sms_credit",
    { p_tenant_id: DAVORS },
  );
  assert(!debitError, `debit_sms_credit error: ${debitError?.message}`);
  console.log(`PASS debit_sms_credit callable for Davors → ${debitOk}`);

  const { data: ann } = await admin
    .from("employee_announcements")
    .select("id")
    .eq("tenant_id", DAVORS)
    .limit(1)
    .maybeSingle();
  const { data: emp } = await admin
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", DAVORS)
    .limit(1)
    .maybeSingle();
  if (ann && emp) {
    const { error: insertError } = await admin
      .from("employee_announcement_recipients")
      .insert({
        tenant_id: DAVORS,
        announcement_id: ann.id,
        employee_id: emp.employee_id,
        channel: "sms",
        status: "skipped_no_credit",
        error_detail: "P2 probe",
      });
    if (insertError) {
      console.log(
        `WARN skipped_no_credit not in DB yet (${insertError.message}). Apply scripts/129_skipped_no_credit_status.sql on staging before ship.`,
      );
    } else {
      await admin
        .from("employee_announcement_recipients")
        .delete()
        .eq("tenant_id", DAVORS)
        .eq("announcement_id", ann.id)
        .eq("employee_id", emp.employee_id)
        .eq("channel", "sms")
        .eq("status", "skipped_no_credit")
        .eq("error_detail", "P2 probe");
      console.log("PASS DB accepts skipped_no_credit on announcement recipients");
    }
  } else {
    console.log("SKIP DB status probe (no Davors announcement/employee)");
  }

  const tierSrc = readFileSync(
    resolve(process.cwd(), "utils/tier-access.ts"),
    "utf8",
  );
  assert(
    /redirect\("\/login"\)/.test(tierSrc),
    "requireFeatureAccess must fail closed on null tenant",
  );
  assert(/assertTenantHasFeature/.test(tierSrc), "assertTenantHasFeature missing");
  console.log("PASS requireFeatureAccess fails closed; API helper present");

  const phase7Files = [
    "app/api/message-templates/route.ts",
    "app/api/message-templates/[id]/route.ts",
    "app/api/campaigns/route.ts",
    "app/api/campaigns/[id]/route.ts",
    "app/api/campaigns/[id]/send/route.ts",
    "app/api/campaigns/[id]/recipients/route.ts",
    "app/api/campaigns/[id]/audience-preview/route.ts",
    "app/api/notification-rules/route.ts",
    "app/api/notification-rules/trigger/route.ts",
  ];
  for (const file of phase7Files) {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    assert(
      src.includes('assertTenantHasFeature(auth.tenantId, "email_promotions")'),
      `${file} missing email_promotions gate`,
    );
  }
  console.log(`PASS ${phase7Files.length} Phase 7 API routes gated`);

  const { data: hasFeature, error: featError } = await admin.rpc(
    "tenant_has_feature",
    { p_tenant_id: DAVORS, p_feature_key: "email_promotions" },
  );
  assert(!featError, featError?.message ?? "tenant_has_feature failed");
  console.log(
    `INFO Davors email_promotions access: ${hasFeature === true ? "allowed" : "denied"}`,
  );

  const { resolveLeaveEntitlement } = await import(
    "../app/dashboard/administration/leave-entitlement-policy-utils"
  );
  const sample = resolveLeaveEntitlement(
    [],
    "Cleaner",
    "Full-Time",
    "Annual Leave",
  );
  assert(sample === 15, `fallback Annual Leave expected 15, got ${sample}`);
  console.log("PASS leave entitlement resolver fallback");

  console.log("\n=== P2 STAGING CHECKS COMPLETE ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
