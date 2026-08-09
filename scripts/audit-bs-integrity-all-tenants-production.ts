/**
 * Read-only: FY2026 Balance Sheet integrity sweep across ALL production tenants.
 *
 * Usage:
 *   npx tsx scripts/audit-bs-integrity-all-tenants-production.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
  BALANCE_TOLERANCE,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";

const PRODUCTION = "tvcurcnmasnocwdxzgvz";
const YEAR = 2026;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseArgs() {
  let envFile = ".env.local.backup";
  let allowProduction = false;
  let investigate = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--allow-production") allowProduction = true;
    else if (arg === "--investigate") investigate = true;
    else if (arg.startsWith("--env-file=")) envFile = arg.slice("--env-file=".length);
  }
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;
  return { envFile, allowProduction, investigate };
}

type TenantRow = { id: string; name: string; slug: string | null; status: string | null };

type MonthImbalance = { month: string; monthIndex: number; diff: number; assets: number; liabilitiesEquity: number };

async function auditTenant(admin: SupabaseClient, tenant: TenantRow) {
  const data = await fetchBalanceSheetPageData(admin, tenant.id, {
    dateRange: null,
  });
  if (data.fetchError) {
    return { tenant, fetchError: data.fetchError, imbalances: [] as MonthImbalance[], report: null };
  }

  const report = buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    YEAR,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    {
      tenantId: tenant.id,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );

  const imbalances: MonthImbalance[] = [];
  for (let i = 0; i < 12; i += 1) {
    const check = getBalanceCheckForPeriod(report, i);
    if (!check.isBalanced) {
      imbalances.push({
        month: MONTHS[i]!,
        monthIndex: i,
        diff: r2(check.difference),
        assets: r2(check.totalAssets),
        liabilitiesEquity: r2(check.totalLiabilitiesAndEquity),
      });
    }
  }

  return { tenant, fetchError: null, imbalances, report };
}

function topDrivingLines(
  report: NonNullable<Awaited<ReturnType<typeof auditTenant>>["report"]>,
  monthIndex: number,
) {
  const assetKeys = [
    "cash", "accounts-receivable", "wht-receivable", "net-vat-receivable",
    "fixed-assets-net", "inventory",
  ];
  const liabilityKeys = [
    "accounts-payable", "accrued-wages-payable", "wht-payable", "net-vat-payable",
    "paye-payable", "ssnit-payable", "bank-loans", "other-long-term-liabilities",
    "directors-loan", "share-capital", "retained-earnings", "inventory-opening-equity",
  ];

  const lines: Array<{ key: string; label: string; amount: number; side: string }> = [];
  for (const row of report.rows) {
    if (row.kind === "section") continue;
    const amount = getBalanceSheetAmountForMonth(row, monthIndex);
    if (Math.abs(amount) < 0.005) continue;
    const side = assetKeys.includes(row.key)
      ? "asset"
      : liabilityKeys.includes(row.key)
        ? "liability-equity"
        : "other";
    lines.push({ key: row.key, label: row.label, amount: r2(amount), side });
  }
  return lines.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 8);
}

async function main() {
  const { envFile, allowProduction, investigate } = parseArgs();
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION)) throw new Error(`Refusing non-production: ${url}`);
  if (!allowProduction) throw new Error("Pass --allow-production");

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }) as SupabaseClient;

  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, name, slug, status")
    .order("name");

  if (error) throw error;

  console.log(`\n=== FY${YEAR} BS integrity sweep | ${tenants?.length ?? 0} tenants ===\n`);

  const results = [];
  for (const tenant of (tenants as TenantRow[]) ?? []) {
    process.stderr.write(`Auditing ${tenant.name}...\n`);
    results.push(await auditTenant(admin, tenant));
  }

  const imbalanced = results.filter((r) => r.imbalances.length > 0);
  const balanced = results.filter((r) => r.imbalances.length === 0 && !r.fetchError);
  const errored = results.filter((r) => r.fetchError);

  console.log("--- Summary ---");
  console.log(`Balanced all 12 months: ${balanced.length}`);
  console.log(`Imbalanced (≥1 month): ${imbalanced.length}`);
  console.log(`Fetch errors: ${errored.length}`);

  console.log("\n--- Imbalanced tenants (month diffs) ---");
  for (const r of imbalanced.sort((a, b) => a.tenant.name.localeCompare(b.tenant.name))) {
    const monthStr = r.imbalances
      .map((m) => `${m.month}=${m.diff.toFixed(2)}`)
      .join(", ");
    const maxDiff = Math.max(...r.imbalances.map((m) => Math.abs(m.diff)));
    console.log(
      `${r.tenant.name} (${r.tenant.id}) | months: ${monthStr} | maxAbs=${maxDiff.toFixed(2)}`,
    );
  }

  if (errored.length > 0) {
    console.log("\n--- Fetch errors ---");
    for (const r of errored) {
      console.log(`${r.tenant.name}: ${r.fetchError}`);
    }
  }

  if (investigate) {
    console.log("\n--- Line-item snapshot (worst month per imbalanced tenant) ---");
    for (const r of imbalanced) {
      if (!r.report) continue;
      const worst = r.imbalances.reduce((a, b) =>
        Math.abs(b.diff) > Math.abs(a.diff) ? b : a,
      );
      console.log(`\n${r.tenant.name} — ${worst.month} diff=${worst.diff.toFixed(2)}`);
      for (const line of topDrivingLines(r.report, worst.monthIndex)) {
        console.log(`  ${line.side.padEnd(16)} ${line.label}: ${line.amount.toFixed(2)}`);
      }
    }
  }

  console.log("\n--- Full matrix (tenant × month diff) ---");
  console.log("Tenant".padEnd(28) + MONTHS.map((m) => m.padStart(8)).join(""));
  for (const r of results.sort((a, b) => a.tenant.name.localeCompare(b.tenant.name))) {
    const cells = MONTHS.map((_, i) => {
      const imb = r.imbalances.find((m) => m.monthIndex === i);
      if (r.fetchError) return "ERR".padStart(8);
      if (!imb) return "0.00".padStart(8);
      return imb.diff.toFixed(2).padStart(8);
    });
    console.log(r.tenant.name.slice(0, 27).padEnd(28) + cells.join(""));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
