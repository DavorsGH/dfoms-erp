/**
 * Read-only: trace Nextronics World All businesses ~55 BS gap Oct–Dec 2026.
 * npx tsx scripts/audits/readonly-nextronics-bs-55-trace-production.ts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const FY = 2026;

function loadEnv(f: string) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnv(".env.local.production-backup-2026-08-25");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name")
    .ilike("name", "%Nextronics%")
    .maybeSingle();
  if (!tenant) {
    console.log("Nextronics tenant not found");
    return;
  }

  const data = await fetchBalanceSheetPageData(admin, tenant.id, {
    viewAllBusinessUnits: true,
    dateRange: null,
  });
  const report = buildStandardBalanceSheetReport(data, tenant.id, FY, {
    allBusinessUnitsDirectorsLoan: true,
    rawManualFinancialEntries: data.initialRawManualEntries,
  });

  for (const mi of [9, 10, 11]) {
    console.log(`\n=== ${tenant.name} All businesses ${FY}-${mi + 1} ===`);
    const check = getBalanceSheetMonthCheck(report, mi);
    console.log("check:", check);
    for (const row of report.rows) {
      if (row.kind === "section") continue;
      const amt = getBalanceSheetAmountForMonth(row, mi);
      if (Math.abs(amt) < 0.005) continue;
      console.log(`${row.key}\t${amt}`);
    }
  }

  console.log("\n=== NULL BU income product_sales (sample) ===");
  const { data: sales } = await admin
    .from("income_register")
    .select("id, invoice_no, date, amount, business_unit_id, cogs_expense_id, sale_quantity, product_id")
    .eq("tenant_id", tenant.id)
    .eq("entry_type", "product_sale")
    .is("business_unit_id", null)
    .gte("date", "2026-10-01")
    .lte("date", "2026-12-31")
    .limit(10);
  console.log(sales);

  console.log("\n=== Zero COGS sales Oct–Dec (any BU) ===");
  const { data: allSales } = await admin
    .from("income_register")
    .select("id, invoice_no, date, amount, business_unit_id, cogs_expense_id, sale_quantity")
    .eq("tenant_id", tenant.id)
    .eq("entry_type", "product_sale")
    .gte("date", "2026-10-01")
    .lte("date", "2026-12-31");
  for (const s of allSales ?? []) {
    let cogs = 0;
    if (s.cogs_expense_id) {
      const { data: er } = await admin
        .from("expense_register")
        .select("amount")
        .eq("id", s.cogs_expense_id)
        .maybeSingle();
      cogs = Number(er?.amount) || 0;
    }
    if (Math.abs(cogs) < 0.0001 && Number(s.sale_quantity) > 0) {
      console.log({ ...s, booked_cogs: cogs });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
