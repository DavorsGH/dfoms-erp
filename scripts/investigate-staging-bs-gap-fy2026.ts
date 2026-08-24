/**
 * Read-only: investigate staging Davors FY2026 BS gap root causes.
 * Usage: npx tsx scripts/investigate-staging-bs-gap-fy2026.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";

const STAGING = "wieflwbfdmjtsdnwbfii";
const TENANT = "00000001-0000-4000-8000-000000000001";

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

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING)) throw new Error("Refusing: staging only");

  const admin = createClient(
    url,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // --- VAT / tax ledger ---
  const { data: taxRows, error: taxErr } = await admin
    .from("tax_ledger_entries")
    .select("*")
    .eq("tenant_id", TENANT)
    .order("entry_date")
    .order("created_at");
  if (taxErr) throw taxErr;

  const open = (taxRows ?? []).filter((r) => r.status === "open");
  const remitted = (taxRows ?? []).filter((r) => r.status !== "open");

  console.log("=== tax_ledger_entries summary ===");
  console.log({ total: taxRows?.length ?? 0, open: open.length, remitted: remitted.length });

  const byDirection: Record<string, number> = {};
  const openByDirection: Record<string, number> = {};
  for (const row of taxRows ?? []) {
    const key = `${row.status}|${row.direction}|${row.tax_component ?? ""}`;
    byDirection[key] = r2((byDirection[key] ?? 0) + Number(row.tax_amount || 0));
    if (row.status === "open") {
      const dk = `${row.direction}|${row.tax_component ?? ""}`;
      openByDirection[dk] = r2((openByDirection[dk] ?? 0) + Number(row.tax_amount || 0));
    }
  }
  console.log("\nOpen tax totals by direction/component:");
  console.log(JSON.stringify(openByDirection, null, 2));

  let outputVat = 0;
  let inputVat = 0;
  for (const row of open) {
    const amt = Number(row.tax_amount) || 0;
    if (row.direction === "output") outputVat += amt;
    if (row.direction === "input") inputVat += amt;
  }
  outputVat = r2(outputVat);
  inputVat = r2(inputVat);
  const netVat = r2(outputVat - inputVat);
  console.log("\nOpen VAT reconciliation (BS formula):");
  console.log({ outputVat, inputVat, netVat, netVatPayable: netVat > 0 ? netVat : 0, netVatReceivable: netVat < 0 ? r2(-netVat) : 0 });

  console.log("\n=== All OPEN tax_ledger_entries (detail) ===");
  for (const row of open) {
    console.log({
      id: row.id,
      entry_date: row.entry_date,
      direction: row.direction,
      tax_component: row.tax_component,
      tax_amount: row.tax_amount,
      status: row.status,
      source_type: row.source_type,
      source_id: row.source_id,
      description: row.description,
      notes: row.notes,
    });
  }

  // Cross-check income/expense VAT columns
  const { data: income } = await admin
    .from("income_register")
    .select("id, date, invoice_no, amount, output_vat_amount, net_of_tax_amount, entry_type, sale_status, service_category")
    .eq("tenant_id", TENANT)
    .gte("date", "2026-01-01")
    .lte("date", "2026-12-31")
    .order("date");

  const { data: expenses } = await admin
    .from("expense_register")
    .select("id, date, receipt_no, description, amount, input_vat_amount, net_of_tax_amount, payment_status, expense_category")
    .eq("tenant_id", TENANT)
    .gte("date", "2026-01-01")
    .lte("date", "2026-12-31")
    .order("date");

  const incomeOutputVat = r2(
    (income ?? []).reduce((s, r) => s + (Number(r.output_vat_amount) || 0), 0),
  );
  const expenseInputVat = r2(
    (expenses ?? []).reduce((s, r) => s + (Number(r.input_vat_amount) || 0), 0),
  );
  console.log("\n=== Register VAT columns (FY2026) ===");
  console.log({
    incomeOutputVatSum: incomeOutputVat,
    expenseInputVatSum: expenseInputVat,
    registerNetVat: r2(incomeOutputVat - expenseInputVat),
  });
  console.log("\nIncome rows with output_vat > 0:");
  for (const r of income ?? []) {
    if (Number(r.output_vat_amount) > 0) {
      console.log({ date: r.date, invoice_no: r.invoice_no, output_vat: r.output_vat_amount, amount: r.amount, type: r.entry_type, status: r.sale_status });
    }
  }
  console.log("\nExpense rows with input_vat > 0:");
  for (const r of expenses ?? []) {
    if (Number(r.input_vat_amount) > 0) {
      console.log({ date: r.date, receipt_no: r.receipt_no, input_vat: r.input_vat_amount, amount: r.amount, category: r.expense_category, paid: r.payment_status });
    }
  }

  // Orphan tax: open entries whose source no longer exists
  console.log("\n=== Orphan check: open tax vs source registers ===");
  for (const row of open.filter((r) => r.source_type && r.source_id)) {
    let exists = true;
    if (row.source_type === "income_register") {
      const { data } = await admin.from("income_register").select("id").eq("id", row.source_id).maybeSingle();
      exists = Boolean(data);
    } else if (row.source_type === "expense_register") {
      const { data } = await admin.from("expense_register").select("id").eq("id", row.source_id).maybeSingle();
      exists = Boolean(data);
    }
    if (!exists) {
      console.log("ORPHAN TAX ENTRY (source missing):", {
        id: row.id,
        direction: row.direction,
        tax_amount: row.tax_amount,
        source_type: row.source_type,
        source_id: row.source_id,
        entry_date: row.entry_date,
      });
    }
  }

  // Manual vat_payable legacy field
  const { data: manual } = await admin
    .from("manual_financial_entries")
    .select("*")
    .eq("tenant_id", TENANT);
  console.log("\n=== manual_financial_entries vat_payable (legacy, NOT used by BS) ===");
  for (const m of manual ?? []) {
    if (Number(m.vat_payable) !== 0) {
      console.log({ period_month: m.period_month, vat_payable: m.vat_payable });
    }
  }

  // --- Inventory: Soda Water ---
  const { data: products } = await admin
    .from("finished_products")
    .select("*")
    .eq("tenant_id", TENANT)
    .ilike("product_name", "%soda%");

  console.log("\n=== Soda Water finished_products ===");
  console.log(JSON.stringify(products, null, 2));

  const productId = products?.[0]?.id;
  if (productId) {
    const { data: movements } = await admin
      .from("stock_movements")
      .select("*")
      .eq("product_id", productId)
      .order("created_at");

    console.log("\n=== stock_movements for Soda Water ===");
    for (const m of movements ?? []) {
      console.log({
        id: m.id,
        movement_type: m.movement_type,
        quantity: m.quantity,
        reference_id: m.reference_id,
        notes: m.notes,
        created_at: m.created_at,
      });
    }

    const { data: purchases } = await admin
      .from("product_purchases")
      .select("*")
      .eq("tenant_id", TENANT)
      .order("purchase_date");

    console.log("\n=== product_purchases (tenant) ===");
    console.log(JSON.stringify(purchases, null, 2));

    const { data: batches } = await admin
      .from("production_batches")
      .select("id, batch_code, product_id, quantity_produced, production_date, created_at")
      .eq("tenant_id", TENANT)
      .eq("product_id", productId);

    console.log("\n=== production_batches for Soda Water ===");
    console.log(JSON.stringify(batches, null, 2));

    const { data: sales } = await admin
      .from("income_register")
      .select("id, date, invoice_no, product_id, sale_quantity, amount, entry_type, sale_status, cogs_expense_id")
      .eq("tenant_id", TENANT)
      .eq("product_id", productId)
      .order("date");

    console.log("\n=== product sales (income_register) for Soda Water ===");
    console.log(JSON.stringify(sales, null, 2));

    const { data: cogsExpenses } = await admin
      .from("expense_register")
      .select("id, date, receipt_no, description, amount, expense_category, sub_category, payment_status")
      .eq("tenant_id", TENANT)
      .in("expense_category", ["Cost of Goods Sold", "COGS"])
      .gte("date", "2026-08-01")
      .lte("date", "2026-10-31");

    console.log("\n=== COGS expenses Aug-Oct 2026 ===");
    console.log(JSON.stringify(cogsExpenses, null, 2));

    const { data: invConfig } = await admin
      .from("inventory_balance_config")
      .select("*")
      .eq("tenant_id", TENANT)
      .maybeSingle();

    console.log("\n=== inventory_balance_config ===");
    console.log(JSON.stringify(invConfig, null, 2));

    const { data: avgCosts } = await admin.rpc("get_finished_product_average_costs", {
      p_tenant_id: TENANT,
    });
    const avg = (avgCosts ?? []).find((r) => r.product_id === productId);
    console.log("\n=== WAC for Soda Water ===");
    console.log({ stock: products?.[0]?.current_stock, average_cost: avg?.average_cost, impliedValue: r2(Number(products?.[0]?.current_stock || 0) * Number(avg?.average_cost || 0)) });
  }

  // BS lines Dec
  const { data: taxForBs } = await admin.from("tax_ledger_entries").select("*").eq("tenant_id", TENANT);
  const bs = buildBalanceSheetReport(
    income ?? [],
    expenses ?? [],
    [],
    [],
    [],
    (expenses ?? []).map((e) => ({
      date: e.date,
      expense_category: e.expense_category ?? "",
      sub_category: e.sub_category ?? "",
      amount: e.amount,
      payment_status: e.payment_status,
      description: e.description ?? null,
      receipt_no: e.receipt_no ?? null,
      notes: e.notes ?? null,
    })),
    [],
    [],
    2026,
    {
      config: null,
      rawMaterials: [],
      finishedProducts: products ?? [],
      finishedProductAverageCosts: productId
        ? [{ product_id: productId, average_cost: 5 }]
        : [],
      cashPurchases: [],
      productCashPurchases: [],
    },
    manual ?? [],
    taxForBs ?? [],
  );
  const dec = getBalanceCheckForPeriod(bs, 11);
  const vatPay = bs.rows.find((r) => r.key === "net-vat-payable")?.amounts[11];
  const invAmt = bs.rows.find((r) => r.key === "inventory")?.amounts[11];
  console.log("\n=== Dec 2026 BS check (rebuilt) ===");
  console.log({ diff: r2(dec.difference), netVatPayable: vatPay, inventory: invAmt });

  // --- June invoice deep dive ---
  const { data: juneInv } = await admin
    .from("income_register")
    .select("*")
    .eq("id", "381db9c1-e52e-443d-9b42-c6e352427262")
    .maybeSingle();
  console.log("\n=== INV-2026-06-001 (main VAT driver) ===");
  console.log(JSON.stringify(juneInv, null, 2));

  console.log("\n=== REMITTED tax_ledger_entries ===");
  for (const row of remitted) {
    console.log({
      id: row.id,
      entry_date: row.entry_date,
      direction: row.direction,
      tax_component: row.tax_component,
      tax_amount: row.tax_amount,
      status: row.status,
      source_type: row.source_type,
      source_id: row.source_id,
      notes: row.notes,
    });
  }

  const { data: capital } = await admin
    .from("capital_contributions")
    .select("*")
    .eq("tenant_id", TENANT)
    .order("date");
  console.log("\n=== capital_contributions ===");
  console.log(JSON.stringify(capital, null, 2));

  console.log("\n=== income_register Jun-Dec 2026 ===");
  for (const row of income ?? []) {
    if (String(row.date).slice(0, 7) >= "2026-06") {
      console.log({
        date: row.date,
        invoice_no: row.invoice_no,
        amount: row.amount,
        amount_received: row.amount_received,
        outstanding_balance: row.outstanding_balance,
        output_vat_amount: row.output_vat_amount,
        net_of_tax_amount: row.net_of_tax_amount,
        wht_amount: row.wht_amount,
        entry_type: row.entry_type,
        sale_status: row.sale_status,
      });
    }
  }

  // Inventory month-by-month from engine (legacy live-paint helper for probe)
  const { calculateInventoryByMonthFromLiveStock } = await import(
    "../app/dashboard/inventory/inventory-balance-sheet-utils"
  );
  const { data: avgAll } = await admin.rpc("get_finished_product_average_costs", {
    p_tenant_id: TENANT,
  });
  const invMonths = calculateInventoryByMonthFromLiveStock(
    [],
    products ?? [],
    avgAll ?? [],
    invConfig ?? null,
    2026,
  );
  console.log("\n=== calculateInventoryByMonthFromLiveStock FY2026 ===");
  console.log(invMonths);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
