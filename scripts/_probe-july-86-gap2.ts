// @ts-nocheck
/**
 * Follow-up probe: verify income load + orphan VAT + reconstruct 86.09.
 *   npx tsx --env-file .env.local.backup scripts/_probe-july-86-gap2.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import { mergePayrollWagesSources } from "../app/dashboard/finance/accrued-wages-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";

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
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
console.log("URL:", url);
if (!url.includes("tvcurcnmasnocwdxzgvz")) throw new Error(`Not production: ${url}`);

const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function main() {
  const incomeRes = await admin
    .from("income_register")
    .select("*")
    .eq("tenant_id", TENANT)
    .order("date", { ascending: true });
  console.log("income error:", incomeRes.error);
  console.log("income count:", incomeRes.data?.length);
  console.log(
    "income by month:",
    Object.entries(
      (incomeRes.data ?? []).reduce((acc, r) => {
        const m = String(r.date).slice(0, 7);
        acc[m] = (acc[m] || 0) + 1;
        return acc;
      }, {}),
    ),
  );

  const julyIncome = (incomeRes.data ?? []).filter((r) =>
    String(r.date).startsWith("2026-07"),
  );
  console.log("\nJuly income rows:", julyIncome.length);
  for (const r of julyIncome) {
    console.log({
      id: r.id,
      date: r.date,
      inv: r.invoice_no,
      amt: r.amount,
      recv: r.amount_received,
      out: r.outstanding_balance,
      vat: r.output_vat_amount,
      net: r.net_of_tax_amount,
      status: r.payment_status,
      cat: r.service_category,
      customer: r.customer_name,
      desc: String(r.description ?? "").slice(0, 80),
    });
  }

  // The VAT source
  const vatSrc = await admin
    .from("income_register")
    .select("*")
    .eq("id", "77029ba3-c3cb-45dc-98aa-4172a7e028b3")
    .maybeSingle();
  console.log("\nVAT source income 77029ba3:", vatSrc.error ?? vatSrc.data);

  // Forfeit income search broader
  const forfeit = await admin
    .from("income_register")
    .select(
      "id, date, invoice_no, amount, outstanding_balance, amount_received, service_category, payment_status, description, notes, customer_name",
    )
    .eq("tenant_id", TENANT)
    .or(
      "amount.eq.88.09,outstanding_balance.eq.88.09,description.ilike.%forfeit%,notes.ilike.%forfeit%,description.ilike.%inactive%,customer_name.ilike.%forfeit%",
    );
  console.log("\nForfeit/88.09 search:", forfeit.data);

  // Amounts near 86.09 across ALL income (any month)
  const near = (incomeRes.data ?? []).filter((r) => {
    const vals = [
      r.amount,
      r.amount_received,
      r.outstanding_balance,
      r.net_of_tax_amount,
      r.output_vat_amount,
      r.wht_amount,
    ].map(Number);
    return vals.some((v) => Math.abs(v - 86.09) < 1 || Math.abs(v - 88.09) < 0.02 || Math.abs(v - 85.76) < 0.02 || Math.abs(v - 126.09) < 0.02 || Math.abs(v - 43.045) < 0.02 || Math.abs(v - 172.18) < 0.02);
  });
  console.log("\nIncome near targets (any month):");
  for (const r of near) {
    console.log({
      date: r.date,
      inv: r.invoice_no,
      amt: r.amount,
      recv: r.amount_received,
      out: r.outstanding_balance,
      vat: r.output_vat_amount,
      status: r.payment_status,
      cat: r.service_category,
      desc: String(r.description ?? "").slice(0, 80),
    });
  }

  // Full BS rebuild with error-checked loads
  const [
    expenseRes,
    faRes,
    apRes,
    capRes,
    manRes,
    histRes,
    procRes,
    mecRes,
    taxRes,
    inventoryBalanceSheet,
  ] = await Promise.all([
    admin.from("expense_register").select("*").eq("tenant_id", TENANT),
    admin.from("fixed_assets").select("*").eq("tenant_id", TENANT),
    admin.from("accounts_payable").select("*").eq("tenant_id", TENANT),
    admin.from("capital_contributions").select("*").eq("tenant_id", TENANT),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
    admin
      .from("payroll_history")
      .select(
        "payroll_month, net_pay, net_only_adjustment, gross_pay, absence_deduction",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay, net_only_adjustment")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay, lock_status")
      .eq("tenant_id", TENANT),
    admin.from("tax_ledger_entries").select("*").eq("tenant_id", TENANT),
    fetchInventoryBalanceSheetInput(admin, TENANT),
  ]);

  for (const [name, res] of [
    ["expense", expenseRes],
    ["fa", faRes],
    ["ap", apRes],
    ["cap", capRes],
    ["manual", manRes],
    ["hist", histRes],
    ["proc", procRes],
    ["mec", mecRes],
    ["tax", taxRes],
  ]) {
    if (res.error) console.log(name, "ERROR", res.error);
    else console.log(name, "count", res.data?.length);
  }

  const incomeEntries = incomeRes.data ?? [];
  const expenseEntries = expenseRes.data ?? [];
  const cashFlow = expenseEntries.map((e) => ({
    date: e.date,
    expense_category: e.expense_category,
    sub_category: e.sub_category,
    amount: Number(e.amount) || 0,
    payment_status: e.payment_status,
    description: e.description ?? null,
    receipt_no: e.receipt_no ?? null,
    notes: e.notes ?? null,
  }));

  const report = buildBalanceSheetReport(
    incomeEntries,
    expenseEntries,
    faRes.data ?? [],
    apRes.data ?? [],
    capRes.data ?? [],
    cashFlow,
    mergePayrollWagesSources(histRes.data ?? [], procRes.data ?? []),
    mecRes.data ?? [],
    FY,
    inventoryBalanceSheet,
    manRes.data ?? [],
    taxRes.data ?? [],
  );

  for (const [label, idx] of [
    ["May", 4],
    ["June", 5],
    ["July", 6],
    ["FY", FULL_YEAR_INDEX],
  ]) {
    const c = getBalanceCheckForPeriod(report, idx);
    console.log(
      `${label}: assets=${c.totalAssets} L+E=${c.totalLiabilitiesAndEquity} diff=${c.difference} balanced=${c.isBalanced}`,
    );
  }

  console.log("\n=== FULL JULY LINES ===");
  for (const row of report.rows.filter((r) => r.kind === "data")) {
    console.log(
      `${row.side}\t${row.key}\t${row.label}\t${r2(row.amounts[6])}`,
    );
  }

  // How does DEDSAV affect AR? outstanding=0 so shouldn't.
  // Check: is Other Income with Unpaid / outstanding 0 excluded from AR but included in RE via P&L?
  // Gap analysis: what if we remove VAT payable 6001.54 orphan?
  const july = getBalanceCheckForPeriod(report, 6);
  console.log("\nIf remove net-vat-payable 6001.54 from L:");
  console.log(
    "adjusted L+E",
    r2(july.totalLiabilitiesAndEquity - 6001.54),
    "diff",
    r2(july.totalAssets - (july.totalLiabilitiesAndEquity - 6001.54)),
  );

  // Manual vat_payable 2092.04 - how does it feed?
  console.log("\nmanual entries:", manRes.data);

  // All tax ledger open
  console.log("\nAll open tax ledger:");
  for (const t of (taxRes.data ?? []).filter((x) => x.status === "open")) {
    console.log({
      date: t.entry_date,
      period: t.period_month,
      dir: t.direction,
      comp: t.tax_component,
      amt: t.tax_amount,
      src: `${t.source_type}:${t.source_id}`,
    });
  }

  // Income with outstanding != 0
  console.log("\nIncome with outstanding > 0:");
  for (const r of incomeEntries.filter((x) => Number(x.outstanding_balance) > 0)) {
    console.log({
      date: r.date,
      inv: r.invoice_no,
      amt: r.amount,
      out: r.outstanding_balance,
      recv: r.amount_received,
      status: r.payment_status,
    });
  }

  // Check June forfeit income specifically - invoice patterns
  console.log("\nOther Income rows:");
  for (const r of incomeEntries.filter(
    (x) => String(x.service_category).toLowerCase().includes("other"),
  )) {
    console.log({
      date: r.date,
      inv: r.invoice_no,
      amt: r.amount,
      out: r.outstanding_balance,
      recv: r.amount_received,
      status: r.payment_status,
      desc: String(r.description ?? "").slice(0, 100),
      notes: String(r.notes ?? "").slice(0, 100),
    });
  }

  // Compute: 126.09 June gap - 85.76 July DEDSAV effect on RE?
  // DEDSAV increases Other Income → increases RE (equity) by 85.76, doesn't change assets (outstd=0)
  // So DEDSAV alone would make Assets - L+E MORE negative by 85.76 (or reduce positive gap)
  // June gap +126.09; after DEDSAV equity up 85.76 → gap becomes 126.09-85.76 = 40.33 if nothing else...
  // User said 86.09 after DEDSAV. 126.09 - 40 = 86.09? 126.09 - 40 = 86.09. What's 40?
  // Or: 88.09 forfeit somehow?
  // 126.09 - 40 = 86.09 → 40 unexplained
  // 88.09 - 2 = 86.09?
  // 85.76 + 0.33?
  console.log("\nGap arithmetic hypotheses:");
  console.log("June gap", 126.09);
  console.log("June gap - DEDSAV 85.76 =", r2(126.09 - 85.76));
  console.log("88.09 forfeit - 2 =", r2(88.09 - 2));
  console.log("126.09 - 40 =", 86.09);
  console.log("88.09 - 2.00 (prior penny?) =", r2(88.09 - 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
