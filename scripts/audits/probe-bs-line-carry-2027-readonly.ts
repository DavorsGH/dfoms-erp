/**
 * Read-only: Dec 2026 / Jan 2027 / Dec 2027 per BS line for one tenant.
 * npx tsx scripts/audits/probe-bs-line-carry-2027-readonly.ts --env=production --tenant=Wraphoria
 * npx tsx scripts/audits/probe-bs-line-carry-2027-readonly.ts --env=staging --tenant=Caanta Market
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
  standardBalanceSheetReportExtrasForView,
} from "@/lib/finance/balance-sheet-standard-report";
import {
  getBalanceSheetAmountForMonth,
  BALANCE_CHECK_ROUNDING_TOLERANCE,
} from "../../app/dashboard/finance/balance-sheet-utils";

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
  const envArg = process.argv.find((a) => a.startsWith("--env="))?.split("=")[1];
  const tenantArg = process.argv.find((a) => a.startsWith("--tenant="))?.split("=")[1];
  if (!envArg || !tenantArg) {
    console.error("Usage: --env=production|staging --tenant=Name");
    process.exit(1);
  }
  return { env: envArg, tenantName: tenantArg };
}

async function buildForRef(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  page: Awaited<ReturnType<typeof fetchBalanceSheetPageData>>,
  ref: Date,
) {
  const pageRef = await fetchBalanceSheetPageData(admin, tenantId, {
    viewAllBusinessUnits: true,
    dateRange: null,
    financialYear: 2027,
    referenceDate: ref,
  });
  if (pageRef.fetchError) throw new Error(pageRef.fetchError);
  const extras = standardBalanceSheetReportExtrasForView({
    viewAllBusinessUnits: true,
    activeBusinessUnitId: null,
    rawManualFinancialEntries: pageRef.initialRawManualEntries,
  });
  const r26 = buildStandardBalanceSheetReport(pageRef, tenantId, 2026, extras);
  const r27 = buildStandardBalanceSheetReport(pageRef, tenantId, 2027, extras);
  return { r26, r27, page: pageRef };
}

async function main() {
  const { env, tenantName } = parseArgs();
  const envFile = env === "production" ? ".env.local.backup" : ".env.staging.local";
  const envPath = resolve(process.cwd(), envFile);
  if (!existsSync(envPath)) {
    console.error(`Missing ${envFile}`);
    process.exit(1);
  }
  loadEnv(envPath);
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, created_at")
    .eq("name", tenantName)
    .maybeSingle();
  if (!tenant) {
    console.error("Tenant not found:", tenantName);
    process.exit(1);
  }

  const refs = [
    { label: "ref 2027-01-31", date: new Date("2027-01-31T12:00:00.000Z") },
    { label: "ref 2027-12-31", date: new Date("2027-12-31T12:00:00.000Z") },
  ];

  for (const { label, date } of refs) {
    console.log(`\n=== ${tenant.name} (${env}) ${label} ===\n`);
    const { r26, r27 } = await buildForRef(admin, tenant.id, null as never, date);

    const dataKeys = r27.rows
      .filter((r) => r.kind !== "section")
      .map((r) => r.key);

    console.log(
      ["line", "Dec2026", "Jan2027", "Dec2027", "Jan-Dec26Δ", "Dec-Jan27Δ"].join("\t"),
    );
    for (const key of dataKeys) {
      const row26 = r26.rows.find((r) => r.key === key);
      const row27 = r27.rows.find((r) => r.key === key);
      if (!row26 || !row27) continue;
      const dec26 = getBalanceSheetAmountForMonth(row26, 11);
      const jan27 = getBalanceSheetAmountForMonth(row27, 0);
      const dec27 = getBalanceSheetAmountForMonth(row27, 11);
      console.log(
        [
          key,
          dec26.toFixed(2),
          jan27.toFixed(2),
          dec27.toFixed(2),
          (jan27 - dec26).toFixed(2),
          (dec27 - jan27).toFixed(2),
        ].join("\t"),
      );
    }

    for (const monthIndex of [0, 11]) {
      const check = getBalanceSheetMonthCheck(r27, monthIndex);
      const monthLabel = monthIndex === 0 ? "Jan 2027" : "Dec 2027";
      console.log(
        `\n${monthLabel} balance: diff=${check.difference.toFixed(2)} balanced=${check.isBalanced} (tol ${BALANCE_CHECK_ROUNDING_TOLERANCE})`,
      );
    }
  }

  const page = await fetchBalanceSheetPageData(admin, tenant.id, {
    viewAllBusinessUnits: true,
    dateRange: null,
  });
  console.log("\n--- Earliest activity (read-only) ---");
  for (const { table, col } of [
    { table: "income_register", col: "date" },
    { table: "expense_register", col: "date" },
    { table: "manual_financial_entries", col: "period_month" },
  ]) {
    const { data } = await admin
      .from(table)
      .select(col)
      .eq("tenant_id", tenant.id)
      .order(col, { ascending: true })
      .limit(1);
    const v = data?.[0]?.[col as keyof (typeof data)[0]];
    console.log(`${table}: ${v ?? "none"}`);
  }
  const inv = page.initialInventoryBalanceSheet?.config;
  console.log("inventory go_live:", inv?.go_live_date ?? "none", "opening_inv:", inv?.opening_inventory_value ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
