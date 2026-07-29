// @ts-nocheck
/**
 * Read-only: isolate July cash -40 and confirm cross-tenant inventory.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildMonthlyCashComponents } from "../app/dashboard/finance/cash-movement-utils";
import { calculateFixedAssetPurchaseOutflowsByMonth } from "../app/dashboard/finance/fixed-assets-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import { mergePayrollWagesSources } from "../app/dashboard/finance/accrued-wages-utils";

function loadEnv(filePath) {
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

loadEnv(resolve(".env.local.backup"));
const TENANT = "00000001-0000-4000-8000-000000000001";
const OTHER = "12df4ee6-3fd1-459f-8d5c-792b5d5b3821";
const FY = 2026;
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function main() {
  console.log("=== Tenant check on finished_products ===");
  const { data: fps } = await admin.from("finished_products").select("*");
  for (const p of fps ?? []) {
    console.log({
      name: p.product_name,
      stock: p.current_stock,
      tenant: p.tenant_id,
      isDavors: p.tenant_id === TENANT,
      isOther: p.tenant_id === OTHER,
    });
  }

  const { data: rms } = await admin.from("raw_materials").select("*");
  console.log(
    "raw_materials tenants:",
    (rms ?? []).map((r) => ({ name: r.material_name, tenant: r.tenant_id })),
  );

  // Does fetchInventoryBalanceSheetInput filter tenant on stock tables?
  const inv = await fetchInventoryBalanceSheetInput(admin, TENANT);
  console.log(
    "fetchInventoryBalanceSheetInput finishedProducts:",
    inv.finishedProducts.map((p) => ({
      id: p.id,
      name: p.product_name,
      stock: p.current_stock,
      // tenant may not be on normalized shape
    })),
  );
  console.log("config tenant context used:", inv.config);

  // Davors-only FA
  const { data: fas } = await admin
    .from("fixed_assets")
    .select("*")
    .eq("tenant_id", TENANT);

  console.log("\n=== July FA purchase outflows ===");
  const faOut = calculateFixedAssetPurchaseOutflowsByMonth(fas ?? [], FY);
  console.log("FA outflows by month [5,6]:", faOut[5], faOut[6]);
  for (const a of fas ?? []) {
    if (String(a.purchase_date).startsWith("2026-07")) {
      const cost = Number(a.original_cost) || 0;
      const qty = Number(a.quantity) || 1;
      console.log({
        name: a.asset_name,
        date: a.purchase_date,
        cost,
        qty,
        lineCostTimesQty: r2(cost * qty),
      });
    }
  }

  // Full cash component breakdown June vs July
  const [
    { data: income },
    { data: expenses },
    { data: capital },
    { data: manual },
    { data: hist },
    { data: mec },
  ] = await Promise.all([
    admin.from("income_register").select("*").eq("tenant_id", TENANT),
    admin.from("expense_register").select("*").eq("tenant_id", TENANT),
    admin.from("capital_contributions").select("*").eq("tenant_id", TENANT),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
    admin
      .from("payroll_history")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay, lock_status")
      .eq("tenant_id", TENANT),
  ]);

  const cashFlow = (expenses ?? []).map((e) => ({
    date: e.date,
    expense_category: e.expense_category,
    sub_category: e.sub_category,
    amount: Number(e.amount) || 0,
    payment_status: e.payment_status,
    description: e.description ?? null,
    receipt_no: e.receipt_no ?? null,
    notes: e.notes ?? null,
  }));

  const staffMap = new Map();
  // use merge like BS does via build path - simplify: buildMonthlyCashComponents accepts map
  const { buildNetPayByPayrollMonth } = await import(
    "../app/dashboard/finance/accrued-wages-utils"
  );
  // Actually buildNetPayByPayrollMonth may not be exported - check
  let staffSalaryNetByPayrollMonth;
  try {
    const aw = await import("../app/dashboard/finance/accrued-wages-utils");
    if (aw.buildNetPayByPayrollMonth) {
      staffSalaryNetByPayrollMonth = aw.buildNetPayByPayrollMonth(
        hist ?? [],
        mec ?? [],
      );
    }
  } catch (_) {}

  const components = buildMonthlyCashComponents(
    {
      incomeEntries: income ?? [],
      expenseEntries: cashFlow,
      capitalContributions: capital ?? [],
      fixedAssets: fas ?? [],
      rawMaterialCashPurchases: inv.cashPurchases ?? [],
      productCashPurchases: inv.productCashPurchases ?? [],
      inventoryConfig: inv.config,
      manualEntries: manual ?? [],
      staffSalaryNetByPayrollMonth,
    },
    FY,
  );

  console.log("\n=== Cash components June (5) vs July (6) ===");
  for (const [name, arr] of Object.entries(components)) {
    if (!Array.isArray(arr)) continue;
    const j = r2(arr[5] ?? 0);
    const u = r2(arr[6] ?? 0);
    if (Math.abs(j) > 0.001 || Math.abs(u) > 0.001) {
      console.log(`${name}: June=${j} July=${u} Δ=${r2(u - j)}`);
    }
  }

  // Closing cash path
  console.log("\nnetMovement June/July:", components.netMovement?.[5], components.netMovement?.[6]);
  console.log(
    "If July FA outflow used cost only (no qty) for White gallons 40:",
  );
  // Check whether FA outflow uses quantity
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
