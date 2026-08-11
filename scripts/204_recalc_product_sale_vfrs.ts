/**
 * One-off: recalculate VFRS on 5 Caanta Market product_sale rows using
 * syncProductSaleVfrsTax() (staging only).
 *
 * Usage:
 *   npx tsx scripts/204_recalc_product_sale_vfrs.ts
 *   npx tsx scripts/204_recalc_product_sale_vfrs.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { REMITTED_STATUS } from "../app/dashboard/finance/tax-ledger-utils";
import { syncProductSaleVfrsTax } from "../utils/product-sale-tax-sync";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const TARGET_INVOICES = [
  "CAN-POS-0024",
  "CAN-POS-0032",
  "CAN-POS-0033",
  "CAN-POS-0031",
  "CAN-POS-0034",
] as const;

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
  let envFile = ".env.staging.local";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--env-file=")) envFile = arg.slice("--env-file=".length);
  }
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;
  return { envFile };
}

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function fetchTargetIncome(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("income_register")
    .select(
      "id, tenant_id, date, invoice_no, amount, net_of_tax_amount, output_vat_amount, output_tax_component, tax_inclusive, entry_type, sale_status",
    )
    .eq("tenant_id", TENANT_ID)
    .eq("entry_type", "product_sale")
    .in("invoice_no", [...TARGET_INVOICES])
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

function printState(label: string, incomeRows: IncomeRow[], ledgerRows: LedgerRow[]) {
  console.log(`\n=== ${label} ===`);
  for (const invoice of TARGET_INVOICES) {
    const income = incomeRows.find((row) => row.invoice_no === invoice);
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
          net_of_tax_amount: income.net_of_tax_amount == null ? null : r2(income.net_of_tax_amount),
          output_vat_amount:
            income.output_vat_amount == null ? null : r2(income.output_vat_amount),
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

async function main() {
  const { envFile } = parseArgs();
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    throw new Error(`Missing Supabase credentials in ${envFile}`);
  }
  if (!url.includes(STAGING_REF)) {
    throw new Error(
      `Refusing: expected staging project ${STAGING_REF}, got ${url}`,
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient;

  const { data: taxSettings, error: settingsError } = await admin
    .from("tax_settings")
    .select("tenant_id, product_sales_tax_rate, vat_registered")
    .eq("tenant_id", TENANT_ID)
    .maybeSingle();

  if (settingsError) throw settingsError;
  console.log("Tenant tax settings:", taxSettings);

  if (Number(taxSettings?.product_sales_tax_rate) !== 0) {
    throw new Error(
      `Refusing: product_sales_tax_rate is ${taxSettings?.product_sales_tax_rate}, expected 0`,
    );
  }

  const incomeRows = await fetchTargetIncome(admin);
  if (incomeRows.length !== TARGET_INVOICES.length) {
    const found = incomeRows.map((row) => row.invoice_no);
    const missing = TARGET_INVOICES.filter((invoice) => !found.includes(invoice));
    throw new Error(
      `Expected ${TARGET_INVOICES.length} income rows, found ${incomeRows.length}. Missing: ${missing.join(", ")}`,
    );
  }

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

  console.log("\nRunning syncProductSaleVfrsTax() for 5 income ids...");
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
