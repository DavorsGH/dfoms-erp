/**
 * Read-only: verify Dashboard BS Check matches Finance Balance Sheet path
 * after shared fetchBalanceSheetPageData + reportOptions fix.
 *
 * Usage:
 *   npx tsx scripts/probe-dashboard-bs-check-staging.ts
 *   npx tsx scripts/probe-dashboard-bs-check-staging.ts --tenant-name Mimshack
 *   npx tsx scripts/probe-dashboard-bs-check-staging.ts --tenant-id <uuid>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildDashboardBalanceSheetCheck,
  buildDashboardViewModel,
} from "../app/dashboard/dashboard-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let envFile = ".env.staging.local";
  let tenantId: string | null = null;
  let tenantName: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--env-file" && args[i + 1]) {
      envFile = args[i + 1]!;
      i += 1;
    } else if (args[i] === "--tenant-id" && args[i + 1]) {
      tenantId = args[i + 1]!;
      i += 1;
    } else if (args[i] === "--tenant-name" && args[i + 1]) {
      tenantName = args[i + 1]!;
      i += 1;
    }
  }
  return { envFile, tenantId, tenantName };
}

function rowDiffs(
  dashboardReport: ReturnType<typeof buildBalanceSheetReport>,
  fullReport: ReturnType<typeof buildBalanceSheetReport>,
  monthIndex: number,
) {
  const diffs: Array<{ key: string; label: string; dashboard: number; full: number; delta: number }> =
    [];
  for (const row of fullReport.rows) {
    if (row.kind === "section") continue;
    const dashRow = dashboardReport.rows.find((r) => r.key === row.key) ?? row;
    const dash = getBalanceSheetAmountForMonth(dashRow, monthIndex);
    const fullAmt = getBalanceSheetAmountForMonth(row, monthIndex);
    const delta = r2(dash - fullAmt);
    if (Math.abs(delta) > 0.001) {
      diffs.push({
        key: row.key,
        label: row.label,
        dashboard: dash,
        full: fullAmt,
        delta,
      });
    }
  }
  return diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

type TenantRow = { id: string; name: string };

async function resolveTenantId(
  admin: SupabaseClient,
  tenantId: string | null,
  tenantName: string | null,
): Promise<TenantRow> {
  if (tenantId) {
    const { data } = await admin
      .from("tenants")
      .select("id, name")
      .eq("id", tenantId)
      .maybeSingle();
    if (!data) throw new Error(`Tenant not found: ${tenantId}`);
    return data as TenantRow;
  }

  const search = tenantName ?? "Davors";
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, name")
    .ilike("name", `%${search}%`)
    .order("name");

  if (error) throw error;
  if (!tenants?.length) throw new Error(`No tenant matching "${search}"`);

  if (tenants.length > 1 && tenantName) {
    console.log("Multiple matches:");
    for (const t of tenants as TenantRow[]) {
      console.log(`  ${t.name} (${t.id})`);
    }
  }

  return tenants[0] as TenantRow;
}

async function probeTenant(
  admin: SupabaseClient,
  tenantId: string,
  tenantName: string,
) {
  const data = await fetchBalanceSheetPageData(admin, tenantId);
  const reportOptions = {
    tenantId,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
  };

  const financeReport = buildBalanceSheetReport(
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
    reportOptions,
  );

  const dashboardVm = buildDashboardViewModel({
    incomeEntries: data.initialIncomeEntries.map((e) => ({
      date: e.date,
      amount: e.amount,
    })),
    productSaleEntries: data.initialIncomeEntries
      .filter((e) => e.entry_type === "product_sale")
      .map((e) => ({
        date: e.date,
        amount: e.amount,
        sale_status: e.sale_status,
      })),
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
    expenseEntries: data.initialExpenseEntries.map((e) => ({
      date: e.date,
      amount: e.amount,
    })),
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
    balanceSheetReportOptions: reportOptions,
    referenceDate: new Date(`${FY}-08-15`),
  });

  const augustKey = dashboardVm.monthOptions.find(
    (o) => o.year === FY && o.month === 8,
  )?.key;
  const dashAugust = augustKey
    ? dashboardVm.monthSnapshots[augustKey]?.summary.balanceCheck
    : null;

  const financeAug = getBalanceCheckForPeriod(financeReport, AUGUST_INDEX);
  const financeDec = getBalanceCheckForPeriod(financeReport, FULL_YEAR_INDEX);
  const wrapperAug = buildDashboardBalanceSheetCheck(financeReport, AUGUST_INDEX);

  const diffs = rowDiffs(financeReport, financeReport, AUGUST_INDEX);

  const widgetParityOk =
    dashAugust !== null &&
    r2(dashAugust.difference) === r2(financeAug.difference) &&
    dashAugust.isBalanced === financeAug.isBalanced;
  const wrapperParityOk =
    r2(wrapperAug.difference) === r2(financeAug.difference) &&
    wrapperAug.isBalanced === financeAug.isBalanced;

  return {
    tenantName,
    tenantId,
    widgetParityOk,
    wrapperParityOk,
    august: {
      widgetDiff: dashAugust?.difference ?? null,
      widgetBalanced: dashAugust?.isBalanced ?? null,
      financeDiff: r2(financeAug.difference),
      financeBalanced: financeAug.isBalanced,
      financeTotalAssets: r2(financeAug.totalAssets),
      financeTotalLE: r2(financeAug.totalLiabilitiesAndEquity),
    },
    december: {
      financeDiff: r2(financeDec.difference),
      financeBalanced: financeDec.isBalanced,
      financeTotalAssets: r2(financeDec.totalAssets),
      financeTotalLE: r2(financeDec.totalLiabilitiesAndEquity),
    },
    augustRowDiffs: diffs,
    fetchError: data.fetchError,
  };
}

async function main() {
  const { envFile, tenantId: argTenantId, tenantName } = parseArgs();
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing non-staging URL: ${url} (expected ${STAGING_REF})`);
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }) as SupabaseClient;

  const tenantsToProbe: TenantRow[] = [];

  if (argTenantId || tenantName) {
    tenantsToProbe.push(await resolveTenantId(admin, argTenantId, tenantName));
  } else {
    tenantsToProbe.push({ id: DAVORS_TENANT_ID, name: "Davors (default)" });
    const caantaId = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
    const { data: caanta } = await admin
      .from("tenants")
      .select("id, name")
      .eq("id", caantaId)
      .maybeSingle();
    if (caanta) {
      tenantsToProbe.push({ id: caanta.id, name: caanta.name });
    }
    const { data: mimshack } = await admin
      .from("tenants")
      .select("id, name")
      .ilike("name", "%Mimshack%")
      .limit(1)
      .maybeSingle();
    if (mimshack) {
      tenantsToProbe.push({ id: mimshack.id, name: mimshack.name });
    }
  }

  console.log(`\n=== Dashboard BS Check probe (staging, FY${FY}) ===\n`);

  const results = [];
  for (const tenant of tenantsToProbe) {
    console.log(`Probing ${tenant.name} (${tenant.id})...`);
    const result = await probeTenant(admin, tenant.id, tenant.name);
    results.push(result);
  }

  console.log("\n--- Summary table ---");
  console.log(
    "Tenant | Aug widget diff | Aug finance diff | Widget parity | Wrapper parity | Dec finance diff | Row diffs",
  );
  let failures = 0;
  for (const r of results) {
    const parityOk = r.widgetParityOk && r.wrapperParityOk;
    if (!parityOk) failures += 1;
    console.log(
      [
        r.tenantName,
        r.august.widgetDiff !== null ? r2(r.august.widgetDiff).toFixed(2) : "n/a",
        r.august.financeDiff.toFixed(2),
        r.widgetParityOk ? "OK" : "FAIL",
        r.wrapperParityOk ? "OK" : "FAIL",
        r.december.financeDiff.toFixed(2),
        r.augustRowDiffs.length,
      ].join(" | "),
    );
    if (r.augustRowDiffs.length > 0) {
      for (const d of r.augustRowDiffs.slice(0, 5)) {
        console.log(
          `  ${d.label}: delta=${d.delta.toFixed(2)} (dash=${d.dashboard.toFixed(2)} finance=${d.full.toFixed(2)})`,
        );
      }
    }
    if (r.fetchError) {
      console.log(`  fetchError: ${r.fetchError}`);
    }
  }

  if (failures > 0) {
    console.log(`\nFAIL: ${failures} tenant(s) failed BS Check parity.`);
    process.exit(1);
  }
  console.log("\nPASS: All tenants — Dashboard BS Check matches Finance.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
