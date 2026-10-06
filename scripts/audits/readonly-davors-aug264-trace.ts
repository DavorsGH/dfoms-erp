import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildCustomerCreditsBalanceSheetOptions,
  fetchBalanceSheetPageData,
} from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  calculateFinishedProductValueAsOf,
} from "../../app/dashboard/inventory/inventory-balance-sheet-utils";
const TENANT = "00000001-0000-4000-8000-000000000001";
const BU = "de215200-e92b-48e3-a7ba-977d7289868c";

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
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: sales } = await admin
    .from("income_register")
    .select(
      "id,date,invoice_no,product_id,sale_quantity,cogs_expense_id,amount,business_unit_id",
    )
    .eq("tenant_id", TENANT)
    .eq("business_unit_id", BU)
    .eq("entry_type", "product_sale")
    .gte("date", "2026-07-01")
    .lte("date", "2026-08-31")
    .neq("sale_status", "voided");

  const data = await fetchBalanceSheetPageData(admin, TENANT, {
    activeBusinessUnitId: BU,
    viewAllBusinessUnits: false,
  });
  const hist = data.initialInventoryBalanceSheet.valuationHistory!;
  const cfg = data.initialInventoryBalanceSheet.config;
  const tenantAvg = new Map(
    (data.initialInventoryBalanceSheet.finishedProductAverageCosts ?? []).map(
      (r) => [r.product_id, Number(r.average_cost) || 0],
    ),
  );

  const jul = calculateFinishedProductValueAsOf(
    hist.finishedProductInflows,
    hist.finishedProductCogs,
    hist.finishedProductInternalUse,
    cfg,
    "2026-07-31",
  );
  const aug = calculateFinishedProductValueAsOf(
    hist.finishedProductInflows,
    hist.finishedProductCogs,
    hist.finishedProductInternalUse,
    cfg,
    "2026-08-31",
  );
  console.log("FP value Jul31", jul, "Aug31", aug, "delta", aug - jul);

  const expenseIds = [
    ...new Set(
      (sales ?? [])
        .map((s) => s.cogs_expense_id)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const { data: expenses } = await admin
    .from("expense_register")
    .select("id,amount,description")
    .in("id", expenseIds.length ? expenseIds : ["00000000-0000-4000-8000-000000000000"]);

  const expMap = new Map(
    (expenses ?? []).map((e) => [String(e.id), Number(e.amount) || 0]),
  );

  console.log("\nJul-Aug product sales (Facilities):");
  for (const s of sales ?? []) {
    const booked = s.cogs_expense_id
      ? expMap.get(String(s.cogs_expense_id)) ?? 0
      : 0;
    console.log(
      `${s.date}\t${s.invoice_no}\tqty=${s.sale_quantity}\tbooked=${booked}`,
    );
  }

  const { data: wacDrift } = await admin.rpc("finished_product_weighted_avg_cost_scoped", {
    p_product_id: null,
  }).catch(() => ({ data: null }));

  void wacDrift;

  for (const code of ["CAN-FP-0004", "SKU-1003", "VOID-DATE-TEST"]) {
    const { data: fp } = await admin
      .from("finished_products")
      .select("id,product_code")
      .eq("tenant_id", TENANT)
      .eq("product_code", code)
      .maybeSingle();
    if (!fp) {
      console.log(`\n${code}: not found`);
      continue;
    }
    const { data: rows } = await admin
      .from("finished_product_balances")
      .select("business_unit_id,current_stock,average_cost_per_unit")
      .eq("tenant_id", TENANT)
      .eq("product_id", fp.id);
    console.log(`\n${code} balances:`);
    for (const r of rows ?? []) {
      const { data: formula } = await admin.rpc(
        "finished_product_weighted_avg_cost_scoped",
        { p_product_id: fp.id, p_business_unit_id: r.business_unit_id },
      );
      console.log(
        `  bu=${r.business_unit_id ?? "NULL"} stock=${r.current_stock} stored=${r.average_cost_per_unit} formula=${formula}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
