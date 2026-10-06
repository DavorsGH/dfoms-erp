/**
 * Read-only: Davors staging BS integrity + rows near GHS 25.00.
 * npx tsx scripts/probe-davors-bs-25-gap-readonly.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { auditTenantBalanceSheetIntegrity } from "../utils/balance-sheet-integrity";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const FISCAL_YEAR = 2026;

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

async function main() {
  let envFile = ".env.staging.local";
  const envEq = process.argv.find((a) => a.startsWith("--env-file="));
  if (envEq) envFile = envEq.slice("--env-file=".length);
  const envIdx = process.argv.indexOf("--env-file");
  if (envIdx >= 0 && process.argv[envIdx + 1]) {
    envFile = process.argv[envIdx + 1]!;
  }
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(`Missing Supabase env in ${envFile}`);
  }

  const admin = createClient(url, key);
  const ref = new Date("2026-10-06T12:00:00.000Z");

  const integrity = await auditTenantBalanceSheetIntegrity(
    admin,
    { id: DAVORS_TENANT_ID, name: "Davors" },
    FISCAL_YEAR,
    ref,
  );

  console.log(
    JSON.stringify(
      {
        integrity: {
          status: integrity.status,
          maxAbsDiff: integrity.maxAbsDiff,
          imbalances: integrity.imbalances.filter((row) => Math.abs(row.diff) >= 0.01),
        },
      },
      null,
      2,
    ),
  );

  const [{ data: income25 }, { data: expense25 }, { data: adjustments }] =
    await Promise.all([
      admin
        .from("income_register")
        .select("id, date, invoice_no, amount, entry_type, sale_status, description")
        .eq("tenant_id", DAVORS_TENANT_ID)
        .or("amount.eq.25,invoice_no.ilike.DF-POS%"),
      admin
        .from("expense_register")
        .select("id, date, receipt_no, amount, description, notes")
        .eq("tenant_id", DAVORS_TENANT_ID)
        .eq("amount", 25),
      admin
        .from("finished_product_stock_adjustments")
        .select(
          "id, adjustment_type, quantity_delta, cost_per_unit, created_at, product:finished_products(product_code)",
        )
        .eq("tenant_id", DAVORS_TENANT_ID),
    ]);

  console.log(
    JSON.stringify(
      {
        incomeNear25: income25 ?? [],
        expense25: expense25 ?? [],
        finishedProductAdjustments: adjustments ?? [],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
