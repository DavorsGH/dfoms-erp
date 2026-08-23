/** READ-ONLY via Supabase REST: all tenants Aug 2026 BS + income audit */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildDashboardViewModel } from "../app/dashboard/dashboard-utils";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

loadEnvForce(resolve(".env.local.backup"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const FY = 2026;
const AUG = 7;
const TODAY = "2026-08-21";

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function augRevenue(entries: Array<{ date: string; amount: number; sale_status?: string | null }>) {
  return r2(
    entries
      .filter((e) => {
        const d = e.date?.slice(0, 10);
        return d >= "2026-08-01" && d <= "2026-08-31" && e.sale_status !== "voided";
      })
      .reduce((s, e) => s + (Number(e.amount) || 0), 0),
  );
}

async function main() {
  const { data: tenants, error } = await admin.from("tenants").select("id, name").order("name");
  if (error) throw error;

  console.log("\n=== All tenants August 2026 ===\n");

  for (const tenant of tenants ?? []) {
    const { data: incomeAug } = await admin
      .from("income_register")
      .select(
        "id, date, invoice_no, amount, amount_received, outstanding_balance, service_category, entry_type, sale_status, voided_at, is_system_adjustment, output_vat_amount, wht_amount, net_of_tax_amount, payment_status, customer_name, client_invoice_id",
      )
      .eq("tenant_id", tenant.id)
      .gte("date", "2026-08-01")
      .lte("date", "2026-08-31");

    const rev = augRevenue(incomeAug ?? []);
    if (rev === 0) continue;

    const data = await fetchBalanceSheetPageData(admin, tenant.id, { dateRange: null });
    if (data.fetchError) {
      console.log(`${tenant.name}: fetch error — ${data.fetchError}`);
      continue;
    }
    const opts = {
      tenantId: tenant.id,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    };
    const report = buildBalanceSheetReport(
      data.initialIncomeEntries,
      data.initialExpenseEntries,
      data.initialFixedAssets,
      data.initialPayableEntries,
      data.initialCapitalContributions,
      data.initialCashFlowExpenseEntries,
      data.initialPayrollHistory,
      data.initialMonthEndCloseNetPay,
      FY,
      data.initialInventoryBalanceSheet,
      data.initialManualEntries,
      data.initialTaxLedgerEntries,
      opts,
    );
    const check = getBalanceCheckForPeriod(report, AUG);
    const vm = buildDashboardViewModel({
      incomeEntries: data.initialIncomeEntries.map((e) => ({ date: e.date, amount: e.amount })),
      productSaleEntries: data.initialIncomeEntries
        .filter((e) => e.entry_type === "product_sale")
        .map((e) => ({ date: e.date, amount: e.amount, sale_status: e.sale_status })),
      profitLossIncomeEntries: data.initialIncomeEntries.map((e) => ({
        date: e.date,
        service_category: e.service_category,
        amount: e.amount,
        entry_type: e.entry_type,
        sale_status: e.sale_status,
        net_of_tax_amount: (e as { net_of_tax_amount?: number | null }).net_of_tax_amount,
        output_vat_amount: (e as { output_vat_amount?: number | null }).output_vat_amount,
      })),
      balanceSheetIncomeEntries: data.initialIncomeEntries,
      expenseEntries: data.initialExpenseEntries.map((e) => ({ date: e.date, amount: e.amount })),
      profitLossExpenseEntries: data.initialExpenseEntries,
      fixedAssets: data.initialFixedAssets,
      payableEntries: data.initialPayableEntries,
      capitalContributions: data.initialCapitalContributions,
      cashFlowIncomeEntries: data.initialCashFlowIncomeEntries,
      cashFlowExpenseEntries: data.initialCashFlowExpenseEntries,
      payrollHistoryWages: data.initialPayrollHistory,
      monthEndCloseNetPay: data.initialMonthEndCloseNetPay,
      manualEntries: data.initialManualEntries,
      monthEndCloseRecords: data.initialMonthEndCloseRecords,
      payrollProcessingEntries: data.initialPayrollProcessingRows.map((e) => ({
        payroll_month: e.payroll_month,
        gross_pay: Number(e.gross_pay) || 0,
      })),
      payrollHistoryEntries: data.initialPayrollHistoryGrossEntries,
      inventoryBalanceSheetInput: data.initialInventoryBalanceSheet,
      taxLedgerEntries: data.initialTaxLedgerEntries,
      balanceSheetReportOptions: opts,
      referenceDate: new Date("2026-08-15"),
    });
    const snapKey = vm.monthOptions.find((o) => o.year === FY && o.month === 8)?.key;
    const dashRev = snapKey ? r2(vm.monthSnapshots[snapKey]?.summary.totalRevenue ?? 0) : null;

    const interesting =
      !check.isBalanced ||
      Math.abs(rev - 647.5) < 0.01 ||
      Math.abs(rev - 684.4) < 0.01 ||
      Math.abs((dashRev ?? 0) - 647.5) < 0.01 ||
      Math.abs((dashRev ?? 0) - 684.4) < 0.01;

    console.log(
      `${tenant.name} (${tenant.id})`,
      `\n  Aug income sum: GHS ${rev.toFixed(2)} (${(incomeAug ?? []).length} rows)`,
      `\n  Dashboard totalRevenue: GHS ${dashRev?.toFixed(2) ?? "n/a"}`,
      `\n  BS: Assets=${check.totalAssets.toFixed(2)} L+E=${check.totalLiabilitiesAndEquity.toFixed(2)} diff=${check.difference.toFixed(2)} ${check.isBalanced ? "BALANCED" : "OUT OF BALANCE"}`,
    );
    if (check.difference > 0) console.log("  → Assets exceed L+E");
    else if (check.difference < 0) console.log("  → L+E exceed Assets");

    if (interesting) {
      console.log("  August income detail:");
      for (const row of incomeAug ?? []) {
        console.log(`    ${JSON.stringify(row)}`);
      }
      if (!check.isBalanced) {
        console.log("  BS line items (August):");
        for (const row of report.rows) {
          if (row.kind === "section") continue;
          const amt = r2(getBalanceSheetAmountForMonth(row, AUG));
          if (Math.abs(amt) > 0.001) console.log(`    ${row.label} (${row.key}): ${amt.toFixed(2)}`);
        }
      }
    }
    console.log("");
  }

  console.log("\n=== Tax ledger income links created today ===");
  const { data: taxToday } = await admin
    .from("tax_ledger_entries")
    .select("*, tenant:tenants(name)")
    .eq("source_table", "income_register")
    .gte("created_at", `${TODAY}T00:00:00`)
    .lt("created_at", `${TODAY}T23:59:59.999Z`)
    .order("created_at", { ascending: false });
  for (const tx of taxToday ?? []) {
    const { data: inc } = await admin
      .from("income_register")
      .select("*")
      .eq("id", tx.source_id)
      .maybeSingle();
    console.log(JSON.stringify({ tax: tx, income: inc }, null, 2));
  }

  console.log("\n=== Income voided today ===");
  const { data: voided } = await admin
    .from("income_register")
    .select("*, tenant:tenants(name)")
    .gte("voided_at", `${TODAY}T00:00:00`)
    .lt("voided_at", `${TODAY}T23:59:59.999Z`);
  console.log(voided);

  console.log("\n=== Client invoices Aug updated/created today ===");
  const { data: invToday } = await admin
    .from("client_invoices")
    .select("*, tenant:tenants(name)")
    .gte("invoice_date", "2026-08-01")
    .lte("invoice_date", "2026-08-31")
    .or(`updated_at.gte.${TODAY}T00:00:00,created_at.gte.${TODAY}T00:00:00`);
  for (const inv of invToday ?? []) {
    const { data: linked } = await admin
      .from("income_register")
      .select("*")
      .eq("client_invoice_id", inv.id);
    console.log(JSON.stringify({ invoice: inv, income: linked }, null, 2));
  }

  console.log("\n=== Mis-shaped is_system_adjustment rows (any date) ===");
  const { data: badAdj } = await admin
    .from("income_register")
    .select("*, tenant:tenants(name)")
    .eq("is_system_adjustment", true)
    .or("outstanding_balance.gt.0,output_vat_amount.gt.0,wht_amount.gt.0");
  console.log(badAdj);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
