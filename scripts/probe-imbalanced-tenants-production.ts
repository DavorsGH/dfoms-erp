/**
 * Read-only: trace Aug→Sep FY2026 BS imbalance drivers for imbalanced production tenants.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";

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

loadEnv(resolve(".env.local.backup"));
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const TENANTS = [
  { name: "Caanta Market", id: "12df4ee6-3fd1-459f-8d5c-792b5d5b3821" },
  { name: "Mimshack-Glo-Ltd", id: "dc7c89d4-df61-4ea5-b2ef-65ab6221c06e" },
  { name: "Nextronics", id: "da8b968e-dd42-48d5-93c5-a3147ff5de72" },
];

async function rowDeltaAugSep(tenantId: string) {
  const data = await fetchBalanceSheetPageData(admin, tenantId, {
    dateRange: null,
  });
  const report = buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    2026,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    {
      tenantId,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );

  const deltas: Array<{ key: string; label: string; aug: number; sep: number; delta: number }> =
    [];
  for (const row of report.rows) {
    if (row.kind === "section") continue;
    const aug = r2(getBalanceSheetAmountForMonth(row, 7));
    const sep = r2(getBalanceSheetAmountForMonth(row, 8));
    const delta = r2(sep - aug);
    if (Math.abs(delta) > 0.001) {
      deltas.push({ key: row.key, label: row.label, aug, sep, delta });
    }
  }
  return deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

async function main() {
  for (const t of TENANTS) {
    console.log(`\n${"=".repeat(60)}\n${t.name} (${t.id})\n${"=".repeat(60)}`);

    console.log("\n--- Aug→Sep BS line deltas ---");
    for (const d of await rowDeltaAugSep(t.id)) {
      console.log(
        `${d.label}: Aug=${d.aug.toFixed(2)} Sep=${d.sep.toFixed(2)} Δ=${d.delta.toFixed(2)}`,
      );
    }

    const { data: capital } = await admin
      .from("capital_contributions")
      .select("id, date, amount, contributed_by, description")
      .eq("tenant_id", t.id)
      .order("date");
    console.log("\ncapital_contributions:", capital);

    const { data: manual } = await admin
      .from("manual_financial_entries")
      .select("id, period_month, entry_type, amount, description, notes")
      .eq("tenant_id", t.id)
      .order("period_month");
    console.log("\nmanual_financial_entries:", manual);

    const { data: income } = await admin
      .from("income_register")
      .select(
        "id, date, invoice_no, amount, amount_received, outstanding_balance, entry_type, sale_status, description",
      )
      .eq("tenant_id", t.id)
      .gte("date", "2026-07-01")
      .lte("date", "2026-09-30")
      .order("date");
    console.log("\nincome Jul-Sep 2026:", income);

    const { data: expenses } = await admin
      .from("expense_register")
      .select(
        "id, date, amount, payment_status, expense_category, description, receipt_no, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", t.id)
      .gte("date", "2026-07-01")
      .lte("date", "2026-09-30")
      .order("date");
    console.log("\nexpenses Jul-Sep 2026:", expenses);

    const { data: invConfig } = await admin
      .from("inventory_balance_config")
      .select("*")
      .eq("tenant_id", t.id);
    console.log("\ninventory_balance_config:", invConfig);

    const { data: fp } = await admin
      .from("finished_products")
      .select("product_code, product_name, current_stock, unit_of_measure")
      .eq("tenant_id", t.id);
    console.log("\nfinished_products:", fp);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
