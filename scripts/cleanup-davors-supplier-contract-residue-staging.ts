// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const TEST_TAG = "SPC-TEST-1790523305563";

function loadEnv(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function bsDiffs(admin) {
  const data = await fetchBalanceSheetPageData(admin, TENANT, {
    activeBusinessUnitId: null,
    viewAllBusinessUnits: true,
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
    FY,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    data.initialWelfareFundEntries,
    {
      tenantId: TENANT,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
  const labels = [
    ["Sep 2026", 8],
    ["Oct 2026", 9],
    ["Nov 2026", 10],
    ["Dec 2026", 11],
  ];
  for (const [label, idx] of labels) {
    const c = getBalanceCheckForPeriod(report, idx);
    console.log(`${label}: diff=${c.difference} balanced=${c.isBalanced}`);
  }
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
  if (ref !== STAGING_REF) throw new Error(`Not staging: ${ref}`);

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== BS before cleanup ===");
  await bsDiffs(admin);

  const { data: orphans } = await admin
    .from("expense_register")
    .select("id, receipt_no")
    .eq("tenant_id", TENANT)
    .like("receipt_no", "AP-ACCRUAL-%");

  const orphanIds = [];
  for (const row of orphans ?? []) {
    const apId = (row.receipt_no ?? "").replace(/^AP-ACCRUAL-/, "");
    const { data: ap } = await admin.from("accounts_payable").select("id").eq("id", apId).maybeSingle();
    if (!ap?.id) orphanIds.push(row.id);
  }
  if (orphanIds.length) {
    const { error } = await admin.from("expense_register").delete().in("id", orphanIds);
    if (error) throw new Error(error.message);
    console.log(`Deleted ${orphanIds.length} orphan AP-ACCRUAL expense rows`);
  }

  const { data: contract } = await admin
    .from("supplier_contracts")
    .select("id, supplier_id")
    .eq("tenant_id", TENANT)
    .like("notes", `${TEST_TAG}%`)
    .maybeSingle();

  if (contract?.id) {
    await admin.from("supplier_contract_deductions").delete().eq("contract_id", contract.id);
    const { data: aps } = await admin
      .from("accounts_payable")
      .select("id")
      .eq("tenant_id", TENANT)
      .eq("source_id", contract.id);
    for (const ap of aps ?? []) {
      const { error } = await admin.rpc("delete_accounts_payable", {
        p_tenant_id: TENANT,
        p_ap_id: ap.id,
      });
      if (error) throw new Error(error.message);
    }
    await admin.from("supplier_contract_amendments").delete().eq("contract_id", contract.id);
    await admin.from("supplier_contracts").delete().eq("id", contract.id);
    if (contract.supplier_id) {
      await admin.from("suppliers").delete().eq("id", contract.supplier_id);
    }
    console.log("Removed SPC-TEST contract tree");
  }

  await admin.from("expense_register").delete().like("notes", `${TEST_TAG}%`);
  await admin.from("expense_register").delete().like("notes", "SPC-AUTH-%");
  console.log("Removed SPC-TEST / SPC-AUTH replacement expenses");

  console.log("\n=== BS after cleanup ===");
  await bsDiffs(admin);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
