/**
 * Production: fix NEXTR-EXP-0002 category + verify Aug 2026 BS balanced.
 * Usage: npx tsx scripts/fix-nextronics-exp-0002-production.ts
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

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const TENANT_ID = "da8b968e-dd42-48d5-93c5-a3147ff5de72";
const EXPENSE_ID = "076bad0b-267a-4dd7-a7cc-e648a7cf7549";
const FY = 2026;
const AUGUST_INDEX = 7;

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

async function fetchPayrollHistory(admin, tenantId: string) {
  const preferred = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", tenantId);
  if (!preferred.error) return preferred.data ?? [];
  const fallback = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay")
    .eq("tenant_id", tenantId);
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []).map((row) => ({
    payroll_month: row.payroll_month,
    net_pay: row.net_pay,
    net_only_adjustment: 0,
  }));
}

async function buildBs(admin, tenantId: string) {
  const [
    { data: income },
    { data: expenses },
    { data: fixedAssets },
    { data: payables },
    { data: capital },
    { data: manual },
    { data: payrollProcessing },
    { data: monthEndClose },
    { data: taxLedger },
    inventoryInput,
    livePayrollBundle,
  ] = await Promise.all([
    admin.from("income_register").select("*").eq("tenant_id", tenantId),
    admin.from("expense_register").select("*").eq("tenant_id", tenantId),
    admin.from("fixed_assets").select("*").eq("tenant_id", tenantId),
    admin.from("accounts_payable").select("*").eq("tenant_id", tenantId),
    admin.from("capital_contributions").select("*").eq("tenant_id", tenantId),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", tenantId),
    admin.from("payroll_processing").select("*").eq("tenant_id", tenantId),
    admin.from("month_end_close").select("*").eq("tenant_id", tenantId),
    admin
      .from("tax_ledger_entries")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("status", "open"),
    fetchInventoryBalanceSheetInput(admin, tenantId),
    fetchPayrollLiveRecalcBundle(admin, { tenantId }),
  ]);

  const payrollHistory = await fetchPayrollHistory(admin, tenantId);
  const payrollMerged = mergePayrollWagesWithLiveOpenMonths(
    payrollHistory,
    payrollProcessing ?? [],
    livePayrollBundle.employees,
    livePayrollBundle.liveContext,
  );

  const cashFlowExpenses = (expenses ?? []).map((e) => ({
    date: e.date,
    expense_category: e.expense_category ?? "",
    sub_category: e.sub_category,
    amount: e.amount,
    payment_status: e.payment_status,
    description: e.description ?? null,
    receipt_no: e.receipt_no ?? null,
    notes: e.notes ?? null,
  }));

  return buildBalanceSheetReport(
    income ?? [],
    expenses ?? [],
    fixedAssets ?? [],
    payables ?? [],
    capital ?? [],
    cashFlowExpenses,
    payrollMerged,
    monthEndClose ?? [],
    FY,
    inventoryInput,
    manual ?? [],
    taxLedger ?? [],
  );
}

async function main() {
  loadEnv(resolve(".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PROD_REF)) throw new Error(`Refusing non-production: ${url}`);

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: before, error: beforeErr } = await admin
    .from("expense_register")
    .select("*")
    .eq("id", EXPENSE_ID)
    .single();
  if (beforeErr) throw new Error(beforeErr.message);

  console.log("=== Before update ===");
  console.log({
    receipt_no: before.receipt_no,
    expense_category: before.expense_category,
    sub_category: before.sub_category,
    amount: before.amount,
    payment_status: before.payment_status,
  });

  const bsBefore = getBalanceCheckForPeriod(
    await buildBs(admin, TENANT_ID),
    AUGUST_INDEX,
  );
  console.log("BS Aug 2026 before:", {
    diff: bsBefore.difference,
    balanced: bsBefore.isBalanced,
    totalAssets: bsBefore.totalAssets,
    totalLE: bsBefore.totalLiabilitiesAndEquity,
  });

  const { data: updated, error: updErr } = await admin
    .from("expense_register")
    .update({ expense_category: "Administrative" })
    .eq("id", EXPENSE_ID)
    .eq("tenant_id", TENANT_ID)
    .select("*")
    .single();
  if (updErr) throw new Error(updErr.message);

  console.log("\n=== After update ===");
  console.log({
    receipt_no: updated.receipt_no,
    expense_category: updated.expense_category,
    sub_category: updated.sub_category,
    amount: updated.amount,
    payment_status: updated.payment_status,
  });

  const bsAfter = getBalanceCheckForPeriod(
    await buildBs(admin, TENANT_ID),
    AUGUST_INDEX,
  );
  console.log("BS Aug 2026 after:", {
    diff: bsAfter.difference,
    balanced: bsAfter.isBalanced,
    totalAssets: bsAfter.totalAssets,
    totalLE: bsAfter.totalLiabilitiesAndEquity,
  });

  if (!bsAfter.isBalanced) {
    throw new Error(`BS still out of balance: diff=${bsAfter.difference}`);
  }
  console.log("\nPASS: Nextronics August 2026 Balance Sheet balanced");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
