/**
 * One-off: recalculate VFRS on named product_sale rows using
 * syncProductSaleVfrsTax() (production tenants).
 *
 * Usage:
 *   npx tsx scripts/204_recalc_product_sale_vfrs.ts --dry-run
 *   npx tsx scripts/204_recalc_product_sale_vfrs.ts --dry-run --env-file .env.local.backup
 *   npx tsx scripts/204_recalc_product_sale_vfrs.ts --apply --env-file .env.local.backup
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { REMITTED_STATUS } from "../app/dashboard/finance/tax-ledger-utils";
import { syncProductSaleVfrsTax } from "../utils/product-sale-tax-sync";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

const TARGET_TENANTS = [
  {
    tenantId: "da8b968e-dd42-48d5-93c5-a3147ff5de72",
    tenantName: "Nextronics",
    invoices: [
      "NEXTR-PSI-0001",
      "NEXTR-PSI-0002",
      "NEXTR-PSI-0003",
      "NEXTR-PSI-0004",
      "NEXTR-POS-0001",
      "NEXTR-POS-0002",
      "NEXTR-POS-0003",
    ],
  },
  {
    tenantId: "dc7c89d4-df61-4ea5-b2ef-65ab6221c06e",
    tenantName: "Mimshack-Glo-Ltd",
    invoices: ["MIMSH-PSI-0001"],
  },
] as const;

const ALL_TARGET_INVOICES = TARGET_TENANTS.flatMap((tenant) => tenant.invoices);
const EXPECTED_ROW_COUNT = ALL_TARGET_INVOICES.length;

type IncomeRow = {
  id: string;
  tenant_id: string;
  date: string;
  invoice_no: string | null;
  amount: number;
  net_of_tax_amount: number | null;
  output_vat_amount: number | null;
  output_tax_component: string | null;
  tax_inclusive: boolean | null;
  entry_type: string;
  sale_status: string | null;
};

type LedgerRow = {
  id: string;
  tenant_id: string;
  source_id: string;
  period_month: string;
  direction: string;
  tax_component: string;
  rate_pct: number | null;
  taxable_base: number;
  tax_amount: number;
  status: string;
};

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
  let envFile = ".env.local.backup";
  let apply = false;
  let dryRun = false;

  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--env-file=")) envFile = arg.slice("--env-file=".length);
  }

  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;

  // Default to dry-run unless --apply is explicitly passed.
  if (!apply) dryRun = true;

  return { envFile, apply, dryRun };
}

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function fetchTargetIncome(admin: SupabaseClient) {
  const tenantIds = TARGET_TENANTS.map((tenant) => tenant.tenantId);
  const { data, error } = await admin
    .from("income_register")
    .select(
      "id, tenant_id, date, invoice_no, amount, net_of_tax_amount, output_vat_amount, output_tax_component, tax_inclusive, entry_type, sale_status",
    )
    .in("tenant_id", tenantIds)
    .eq("entry_type", "product_sale")
    .in("invoice_no", [...ALL_TARGET_INVOICES])
    .order("tenant_id")
    .order("date")
    .order("invoice_no");

  if (error) throw error;
  return (data as IncomeRow[] | null) ?? [];
}

async function fetchLedgerForIncomeIds(
  admin: SupabaseClient,
  incomeIds: string[],
) {
  if (incomeIds.length === 0) return [] as LedgerRow[];

  const { data, error } = await admin
    .from("tax_ledger_entries")
    .select(
      "id, tenant_id, source_id, period_month, direction, tax_component, rate_pct, taxable_base, tax_amount, status",
    )
    .eq("source_type", "income_register")
    .in("source_id", incomeIds)
    .order("source_id")
    .order("direction")
    .order("tax_component");

  if (error) throw error;
  return (data as LedgerRow[] | null) ?? [];
}

function printState(
  label: string,
  incomeRows: IncomeRow[],
  ledgerRows: LedgerRow[],
) {
  console.log(`\n=== ${label} ===`);

  for (const tenant of TARGET_TENANTS) {
    console.log(`\n--- ${tenant.tenantName} (${tenant.tenantId}) ---`);

    for (const invoice of tenant.invoices) {
      const income = incomeRows.find(
        (row) =>
          row.tenant_id === tenant.tenantId && row.invoice_no === invoice,
      );
      if (!income) {
        console.log(`\n${invoice}: NOT FOUND`);
        continue;
      }

      console.log(`\n${invoice} (${income.id})`);
      console.log(
        JSON.stringify(
          {
            date: income.date,
            amount: r2(income.amount),
            tax_inclusive: income.tax_inclusive,
            net_of_tax_amount:
              income.net_of_tax_amount == null
                ? null
                : r2(income.net_of_tax_amount),
            output_vat_amount:
              income.output_vat_amount == null
                ? null
                : r2(income.output_vat_amount),
            output_tax_component: income.output_tax_component,
            sale_status: income.sale_status,
          },
          null,
          2,
        ),
      );

      const legs = ledgerRows.filter((leg) => leg.source_id === income.id);
      if (legs.length === 0) {
        console.log("  tax_ledger_entries: (none)");
        continue;
      }

      for (const leg of legs) {
        console.log(
          `  tax_ledger_entries: ${leg.direction}/${leg.tax_component} period=${leg.period_month.slice(0, 7)} status=${leg.status} rate=${leg.rate_pct} base=${r2(leg.taxable_base)} tax=${r2(leg.tax_amount)} id=${leg.id}`,
        );
      }
    }
  }
}

async function validateTenantTaxSettings(admin: SupabaseClient) {
  for (const tenant of TARGET_TENANTS) {
    const { data, error } = await admin
      .from("tax_settings")
      .select("tenant_id, product_sales_tax_rate, vat_registered")
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();

    if (error) throw error;

    console.log(`${tenant.tenantName} tax settings:`, data);

    if (Number(data?.product_sales_tax_rate) !== 0) {
      throw new Error(
        `Refusing: ${tenant.tenantName} product_sales_tax_rate is ${data?.product_sales_tax_rate}, expected 0`,
      );
    }
  }
}

function validateIncomeRows(incomeRows: IncomeRow[]) {
  const unexpectedTenant = incomeRows.find(
    (row) => !TARGET_TENANTS.some((tenant) => tenant.tenantId === row.tenant_id),
  );
  if (unexpectedTenant) {
    throw new Error(`Unexpected tenant on matched row: ${unexpectedTenant.tenant_id}`);
  }

  if (incomeRows.length !== EXPECTED_ROW_COUNT) {
    const found = incomeRows.map((row) => `${row.tenant_id}:${row.invoice_no}`);
    const expected = TARGET_TENANTS.flatMap((tenant) =>
      tenant.invoices.map((invoice) => `${tenant.tenantId}:${invoice}`),
    );
    const missing = expected.filter((key) => !found.includes(key));
    throw new Error(
      `Expected ${EXPECTED_ROW_COUNT} income rows, found ${incomeRows.length}. Missing: ${missing.join(", ")}`,
    );
  }

  for (const tenant of TARGET_TENANTS) {
    for (const invoice of tenant.invoices) {
      const matches = incomeRows.filter(
        (row) => row.tenant_id === tenant.tenantId && row.invoice_no === invoice,
      );
      if (matches.length !== 1) {
        throw new Error(
          `Expected exactly one row for ${tenant.tenantName} ${invoice}, found ${matches.length}`,
        );
      }
    }
  }
}

async function main() {
  const { envFile, apply, dryRun } = parseArgs();
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    throw new Error(`Missing Supabase credentials in ${envFile}`);
  }
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(
      `Refusing: expected production project ${PRODUCTION_REF}, got ${url}`,
    );
  }

  console.log(`Environment: ${url}`);
  console.log(`Mode: ${dryRun ? "DRY-RUN (no writes)" : "APPLY (will mutate data)"}`);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient;

  await validateTenantTaxSettings(admin);

  const incomeRows = await fetchTargetIncome(admin);
  validateIncomeRows(incomeRows);

  const incomeIds = incomeRows.map((row) => row.id);
  const beforeLedger = await fetchLedgerForIncomeIds(admin, incomeIds);

  const remittedLegs = beforeLedger.filter(
    (leg) =>
      leg.tax_component === "vfrs" &&
      leg.direction === "output" &&
      leg.status === REMITTED_STATUS,
  );
  if (remittedLegs.length > 0) {
    throw new Error(
      `Refusing: ${remittedLegs.length} VFRS leg(s) already remitted`,
    );
  }

  printState("BEFORE", incomeRows, beforeLedger);

  if (dryRun) {
    console.log("\n=== DRY-RUN complete — no changes applied ===");
    console.log(
      "Review the BEFORE state above. To apply on production, rerun with:",
    );
    console.log(
      "  npx tsx scripts/204_recalc_product_sale_vfrs.ts --apply --env-file .env.local.backup",
    );
    return;
  }

  console.log(
    `\nRunning syncProductSaleVfrsTax() for ${incomeIds.length} income ids...`,
  );
  const { error: syncError } = await syncProductSaleVfrsTax(admin, incomeIds);
  if (syncError) {
    throw new Error(`syncProductSaleVfrsTax failed: ${syncError}`);
  }

  const afterIncome = await fetchTargetIncome(admin);
  const afterLedger = await fetchLedgerForIncomeIds(admin, incomeIds);
  printState("AFTER", afterIncome, afterLedger);

  const remainingVat = afterIncome.reduce(
    (sum, row) => sum + (Number(row.output_vat_amount) || 0),
    0,
  );
  const remainingVfrsLegs = afterLedger.filter(
    (leg) => leg.direction === "output" && leg.tax_component === "vfrs",
  );

  console.log("\n=== Summary ===");
  console.log(`Remaining output_vat_amount sum: GHS ${r2(remainingVat)}`);
  console.log(`Remaining VFRS ledger legs: ${remainingVfrsLegs.length}`);
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
