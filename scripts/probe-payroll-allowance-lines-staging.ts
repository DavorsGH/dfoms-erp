/**
 * Staging integrity probe for payroll_allowance_lines (any tenant / month).
 *
 * Usage:
 *   npx tsx scripts/probe-payroll-allowance-lines-staging.ts
 *   npx tsx scripts/probe-payroll-allowance-lines-staging.ts --tenant-id <uuid> --month 2026-08-01
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let envFile = ".env.staging.local";
  let tenantId: string | null = null;
  let month = "2026-08-01";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--env-file" && args[i + 1]) {
      envFile = args[i + 1]!;
      i += 1;
    } else if (args[i] === "--tenant-id" && args[i + 1]) {
      tenantId = args[i + 1]!;
      i += 1;
    } else if (args[i] === "--month" && args[i + 1]) {
      month = args[i + 1]!.slice(0, 10);
      i += 1;
    }
  }
  return { envFile, tenantId, month };
}

async function main() {
  const { envFile, tenantId: argTenantId, month } = parseArgs();
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing non-staging URL (expected ${STAGING_REF})`);
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  let tenantId = argTenantId;
  let tenantName = tenantId ?? "unknown";
  if (!tenantId) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("id, name")
      .ilike("name", "%Davors%")
      .limit(1)
      .maybeSingle();
    if (!tenant) throw new Error("No tenant found");
    tenantId = tenant.id;
    tenantName = tenant.name;
  }

  const { data: lines, error } = await admin
    .from("payroll_allowance_lines")
    .select("id, stage, employee_id, allowance_code")
    .eq("tenant_id", tenantId)
    .eq("payroll_month", month);

  if (error) throw error;

  const rows = lines ?? [];
  const byKey = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.stage}|${row.employee_id}|${row.allowance_code}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  const dupes = [...byKey.entries()].filter(([, c]) => c > 1);

  const { count: processingCount } = await admin
    .from("payroll_processing")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("payroll_month", month);

  const { data: allowanceTypes } = await admin
    .from("allowance_types")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  const activeTypes = allowanceTypes?.length ?? 0;
  const processingLines = rows.filter((r) => r.stage === "processing");
  const expectedIfFull =
    activeTypes > 0 ? (processingCount ?? 0) * activeTypes : null;

  console.log(`\n=== payroll_allowance_lines integrity (${tenantName}, ${month}) ===`);
  console.log(`Total rows: ${rows.length}`);
  console.log(`Processing rows: ${processingLines.length}`);
  console.log(`payroll_processing employees: ${processingCount ?? 0}`);
  console.log(`Active allowance types: ${activeTypes}`);
  if (expectedIfFull !== null) {
    console.log(`Expected processing lines (employees × types): ${expectedIfFull}`);
  }
  console.log(`Duplicate constraint keys: ${dupes.length}`);

  if (dupes.length > 0) {
    for (const [key, count] of dupes.slice(0, 10)) {
      console.log(`  DUPLICATE ${key} (${count} rows)`);
    }
    process.exit(1);
  }

  console.log("\nPASS: no duplicate (stage, employee_id, allowance_code) groups.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
