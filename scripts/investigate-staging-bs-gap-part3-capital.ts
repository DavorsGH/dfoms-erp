/**
 * Read-only Part 3: investigate Davors FY2026 capital contributions & owner true-ups
 * on staging for BS gap residual cleanup proposal.
 *
 * Usage: npx tsx scripts/investigate-staging-bs-gap-part3-capital.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";

const STAGING = "wieflwbfdmjtsdnwbfii";
const TENANT = "00000001-0000-4000-8000-000000000001";
const YEAR = 2026;

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

async function loadBundle(admin) {
  const [inc, exp, fa, ap, cap, man, pp, mec, tax, ph, live, inv] =
    await Promise.all([
      admin.from("income_register").select("*").eq("tenant_id", TENANT),
      admin.from("expense_register").select("*").eq("tenant_id", TENANT),
      admin.from("fixed_assets").select("*").eq("tenant_id", TENANT),
      admin.from("accounts_payable").select("*").eq("tenant_id", TENANT),
      admin.from("capital_contributions").select("*").eq("tenant_id", TENANT),
      admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
      admin.from("payroll_processing").select("*").eq("tenant_id", TENANT),
      admin.from("month_end_close").select("*").eq("tenant_id", TENANT),
      admin.from("tax_ledger_entries").select("*").eq("tenant_id", TENANT),
      admin
        .from("payroll_history")
        .select("payroll_month, net_pay")
        .eq("tenant_id", TENANT),
      fetchPayrollLiveRecalcBundle(admin, { tenantId: TENANT }),
      fetchInventoryBalanceSheetInput(admin, TENANT),
    ]);
  const wages = mergePayrollWagesWithLiveOpenMonths(
    ph.data ?? [],
    pp.data ?? [],
    live.employees,
    live.liveContext,
  );
  const cashFlow = (exp.data ?? []).map((e) => ({
    date: e.date,
    expense_category: e.expense_category ?? "",
    sub_category: e.sub_category ?? "",
    amount: e.amount,
    payment_status: e.payment_status,
    description: e.description ?? null,
    receipt_no: e.receipt_no ?? null,
    notes: e.notes ?? null,
  }));
  return {
    income: inc.data ?? [],
    expenses: exp.data ?? [],
    fixedAssets: fa.data ?? [],
    payables: ap.data ?? [],
    capital: cap.data ?? [],
    manual: man.data ?? [],
    monthEndClose: mec.data ?? [],
    taxLedger: tax.data ?? [],
    wages,
    cashFlow,
    inv,
  };
}

function decGap(bundle, refDate = new Date("2026-12-31T12:00:00")) {
  const inv = { ...bundle.inv, referenceDate: refDate };
  const bs = buildBalanceSheetReport(
    bundle.income,
    bundle.expenses,
    bundle.fixedAssets,
    bundle.payables,
    bundle.capital,
    bundle.cashFlow,
    bundle.wages,
    bundle.monthEndClose,
    YEAR,
    inv,
    bundle.manual,
    bundle.taxLedger,
  );
  const dec = getBalanceCheckForPeriod(bs, 11);
  return {
    diff: r2(dec.difference),
    shareCapital: r2(bs.rows.find((r) => r.key === "share-capital")?.amounts[11] ?? 0),
    retainedEarnings: r2(bs.rows.find((r) => r.key === "retained-earnings")?.amounts[11] ?? 0),
    cash: r2(bs.rows.find((r) => r.key === "cash")?.amounts[11] ?? 0),
    netVatPayable: r2(bs.rows.find((r) => r.key === "net-vat-payable")?.amounts[11] ?? 0),
    inventory: r2(bs.rows.find((r) => r.key === "inventory")?.amounts[11] ?? 0),
    totalAssets: r2(dec.totalAssets),
    totalLE: r2(dec.totalLiabilitiesAndEquity),
  };
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

  const bundle = await loadBundle(admin);
  const baseline = decGap(bundle);
  console.log("=== Post 1B+2B BS snapshot (Dec as-at 31 Dec 2026) ===");
  console.log(JSON.stringify(baseline, null, 2));

  console.log("\n=== capital_contributions (all Davors) ===");
  const caps = [...bundle.capital].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
  let capTotal = 0;
  for (const row of caps) {
    capTotal += Number(row.amount) || 0;
    console.log({
      id: row.id,
      date: row.date,
      amount: row.amount,
      contributed_by: row.contributed_by,
      description: row.description,
    });
  }
  console.log("Sum:", r2(capTotal));

  console.log("\n=== Remaining open tax_ledger_entries ===");
  for (const row of bundle.taxLedger.filter((t) => t.status === "open")) {
    console.log({
      id: row.id,
      entry_date: row.entry_date,
      direction: row.direction,
      tax_component: row.tax_component,
      tax_amount: row.tax_amount,
      notes: row.notes,
      source_type: row.source_type,
      source_id: row.source_id,
    });
  }

  console.log("\n=== FY2026 income_register (remaining) ===");
  for (const row of bundle.income
    .filter((i) => String(i.date).startsWith("2026"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    console.log({
      date: row.date,
      invoice_no: row.invoice_no,
      amount: row.amount,
      amount_received: row.amount_received,
      output_vat: row.output_vat_amount,
      entry_type: row.entry_type,
      sale_status: row.sale_status,
    });
  }

  console.log("\n=== fixed_assets ===");
  for (const row of bundle.fixedAssets) {
    console.log({
      asset_id: row.asset_id,
      asset_name: row.asset_name,
      purchase_date: row.purchase_date,
      original_cost: row.original_cost,
      quantity: row.quantity,
    });
  }

  console.log("\n=== Jun/Jul 2026 paid expenses (sample, top 20 by amount) ===");
  const junJulPaid = bundle.expenses
    .filter(
      (e) =>
        String(e.date).slice(0, 7) >= "2026-06" &&
        String(e.date).slice(0, 7) <= "2026-07" &&
        String(e.payment_status ?? "").toLowerCase() === "paid",
    )
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 20);
  let paidSum = 0;
  for (const row of junJulPaid) {
    paidSum += Number(row.amount) || 0;
    console.log({
      date: row.date,
      receipt_no: row.receipt_no,
      amount: row.amount,
      category: row.expense_category,
      sub: row.sub_category,
      description: row.description?.slice(0, 60),
    });
  }

  console.log("\n=== manual_financial_entries ===");
  console.log(JSON.stringify(bundle.manual, null, 2));

  console.log("\n=== Simulated capital removal scenarios (Dec gap) ===");
  const scenarios = [
    { label: "baseline", capFilter: () => true },
    {
      label: "remove Jun 30 true-ups (17475.52 + 200)",
      capFilter: (c) => String(c.date) !== "2026-06-30",
    },
    {
      label: "remove Jun 9 FA funding (6779)",
      capFilter: (c) => String(c.date) !== "2026-06-09",
    },
    {
      label: "remove all June contributions",
      capFilter: (c) => !String(c.date).startsWith("2026-06"),
    },
    {
      label: "remove all July contributions",
      capFilter: (c) => !String(c.date).startsWith("2026-07"),
    },
    {
      label: "remove ALL capital contributions",
      capFilter: () => false,
    },
  ];

  for (const scenario of scenarios) {
    const b = { ...bundle, capital: bundle.capital.filter(scenario.capFilter) };
    const g = decGap(b);
    console.log(scenario.label, g);
  }

  console.log("\n=== Simulated: mark remaining open tax paid ===");
  const taxPaid = {
    ...bundle,
    taxLedger: bundle.taxLedger.map((t) =>
      t.status === "open" ? { ...t, status: "paid" } : t,
    ),
  };
  console.log("tax paid only", decGap(taxPaid));

  console.log("\n=== Simulated: tax paid + remove all capital ===");
  console.log(
    "combined",
    decGap({ ...taxPaid, capital: [] }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
