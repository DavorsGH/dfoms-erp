import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";

const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const OCT = 9;

function loadEnv() {
  for (const line of readFileSync(resolve(".env.staging.local"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadEnv();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: bu } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", TENANT)
    .ilike("name", "%Facilities%")
    .single();

  const data = await fetchBalanceSheetPageData(admin, TENANT, {
    viewAllBusinessUnits: false,
    activeBusinessUnitId: bu!.id,
  });
  const report = buildStandardBalanceSheetReport(data, TENANT, FY);
  console.log("Oct check:", getBalanceSheetMonthCheck(report, OCT));
  for (const row of report.rows) {
    if (row.kind === "section") continue;
    const amt = getBalanceSheetAmountForMonth(row, OCT);
    if (Math.abs(amt) >= 0.005) console.log(row.key, amt);
  }

  const { data: repairDry } = await admin.rpc(
    "repair_tenant_inventory_stock_adjustment_register_links",
    { p_tenant_id: TENANT, p_dry_run: true },
  );
  console.log("\nrepair dry-run rows:", repairDry?.length ?? repairDry);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
