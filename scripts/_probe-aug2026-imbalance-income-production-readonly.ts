/**
 * READ-ONLY: Diagnose August FY2026 BS imbalance + income_register changes today.
 *
 * Usage:
 *   npx tsx scripts/_probe-aug2026-imbalance-income-production-readonly.ts --env-file .env.local.backup --allow-production
 *   npx tsx scripts/_probe-aug2026-imbalance-income-production-readonly.ts --env-file .env.local.backup --allow-production --tenant-name "Caanta"
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  buildDashboardViewModel,
  buildDashboardBalanceSheetCheck,
} from "../app/dashboard/dashboard-utils";

function sumAugustRevenue(
  entries: Array<{ date: string; amount: number; sale_status?: string | null }>,
) {
  return entries
    .filter((e) => {
      const d = e.date?.slice(0, 10);
      if (d < `${FY}-08-01` || d > `${FY}-08-31`) return false;
      if (e.sale_status === "voided") return false;
      return true;
    })
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const AUGUST_INDEX = 7;
const TODAY = "2026-08-21";

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
  let envFile = ".env.local.backup";
  let allowProduction = false;
  let tenantId: string | null = null;
  let tenantName: string | null = null;
  let allTenants = false;
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i]!;
    if (a === "--env-file" && process.argv[i + 1]) {
      envFile = process.argv[++i]!;
    } else if (a === "--allow-production") {
      allowProduction = true;
    } else if (a === "--tenant-id" && process.argv[i + 1]) {
      tenantId = process.argv[++i]!;
    } else if (a === "--tenant-name" && process.argv[i + 1]) {
      tenantName = process.argv[++i]!;
    } else if (a === "--all-tenants") {
      allTenants = true;
    }
  }
  return { envFile, allowProduction, tenantId, tenantName, allTenants };
}

async function resolveTenants(
  admin: SupabaseClient,
  tenantId: string | null,
  tenantName: string | null,
  allTenants: boolean,
) {
  if (allTenants) {
    const { data, error } = await admin
      .from("tenants")
      .select("id, name")
      .order("name");
    if (error) throw error;
    return data ?? [];
  }
  if (tenantId) {
    const { data } = await admin
      .from("tenants")
      .select("id, name")
      .eq("id", tenantId)
      .maybeSingle();
    if (!data) throw new Error(`Tenant not found: ${tenantId}`);
    return [data];
  }
  if (tenantName) {
    const { data, error } = await admin
      .from("tenants")
      .select("id, name")
      .ilike("name", `%${tenantName}%`)
      .order("name");
    if (error) throw error;
    if (!data?.length) throw new Error(`No tenant matching "${tenantName}"`);
    return data;
  }
  return [{ id: DAVORS_TENANT_ID, name: "Davors (default)" }];
}

type IncomeRow = Record<string, unknown>;

function isToday(iso: unknown) {
  return typeof iso === "string" && iso.startsWith(TODAY);
}

async function probeTenant(
  admin: SupabaseClient,
  tenant: { id: string; name: string },
) {
  const data = await fetchBalanceSheetPageData(admin, tenant.id, {
    dateRange: null,
  });
  if (data.fetchError) {
    return { tenant, error: data.fetchError };
  }

  const reportOptions = {
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
    reportOptions,
  );

  const bsCheck = getBalanceCheckForPeriod(report, AUGUST_INDEX);
  const widgetCheck = buildDashboardBalanceSheetCheck(report, AUGUST_INDEX);

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
      net_of_tax_amount: (e as { net_of_tax_amount?: number | null })
        .net_of_tax_amount,
      output_vat_amount: (e as { output_vat_amount?: number | null })
        .output_vat_amount,
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
  const dashSnap = augustKey
    ? dashboardVm.monthSnapshots[augustKey]?.summary
    : null;

  const totalRevenueFromVm = dashSnap?.totalRevenue ?? null;
  const totalRevenueDirect = r2(
    sumAugustRevenue(
      data.initialIncomeEntries.map((e) => ({
        date: e.date,
        amount: e.amount,
        sale_status: e.sale_status,
      })),
    ),
  );

  const augustIncome = data.initialIncomeEntries.filter((e) => {
    const d = e.date?.slice(0, 10);
    return d >= `${FY}-08-01` && d <= `${FY}-08-31`;
  });

  const { data: rawIncomeRows, error: incomeErr } = await admin
    .from("income_register")
    .select("*")
    .eq("tenant_id", tenant.id)
    .gte("date", `${FY}-08-01`)
    .lte("date", `${FY}-08-31`)
    .order("updated_at", { ascending: false, nullsFirst: false });

  if (incomeErr) {
    return { tenant, error: `income_register query: ${incomeErr.message}` };
  }

  const rows = (rawIncomeRows ?? []) as IncomeRow[];
  const changedToday = rows.filter(
    (r) => isToday(r.updated_at) || isToday(r.created_at),
  );
  const createdToday = rows.filter((r) => isToday(r.created_at));
  const updatedTodayNotCreated = rows.filter(
    (r) => isToday(r.updated_at) && !isToday(r.created_at),
  );

  const suspicious = rows.filter((r) => {
    const amt = r2(Number(r.amount) || 0);
    const ob = r2(Number(r.outstanding_balance) || 0);
    const vat = r2(Number(r.output_vat_amount) || 0);
    const wht = r2(Number(r.wht_amount) || 0);
    const isAdj = Boolean(r.is_system_adjustment);
    return (
      Math.abs(amt - 36.9) < 0.01 ||
      Math.abs(ob - 36.9) < 0.01 ||
      (isAdj && (ob > 0 || vat > 0 || wht > 0)) ||
      (!isAdj &&
        r.service_category &&
        String(r.service_category).toLowerCase().includes("other") &&
        ob > 0 &&
        r2(Number(r.amount_received) || 0) === 0)
    );
  });

  const assetSideKeys = [
    "cash",
    "accounts_receivable",
    "inventory",
    "fixed_assets",
    "prepaid_expenses",
  ];
  const leSideKeys = [
    "accounts_payable",
    "accrued_wages",
    "tax_payable",
    "directors_loan",
    "retained_earnings",
    "capital",
  ];

  const rowAmounts: Array<{ key: string; label: string; amount: number }> = [];
  for (const row of report.rows) {
    if (row.kind === "section") continue;
    rowAmounts.push({
      key: row.key,
      label: row.label,
      amount: r2(getBalanceSheetAmountForMonth(row, AUGUST_INDEX)),
    });
  }

  const { data: taxLinks } = await admin
    .from("tax_ledger_entries")
    .select(
      "id, source_table, source_id, entry_type, amount, period_month, created_at, updated_at",
    )
    .eq("tenant_id", tenant.id)
    .eq("source_table", "income_register")
    .gte("period_month", `${FY}-08-01`)
    .lte("period_month", `${FY}-08-31`);

  const taxForChangedIncome = (taxLinks ?? []).filter((t) =>
    changedToday.some((r) => r.id === t.source_id),
  );

  return {
    tenant,
    bsCheck,
    widgetCheck,
    totalRevenueFromVm: totalRevenueFromVm !== null ? r2(totalRevenueFromVm) : null,
    totalRevenueDirect: r2(totalRevenueDirect),
    augustIncomeCount: augustIncome.length,
    augustIncomeSum: r2(
      augustIncome.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    ),
    changedToday,
    createdToday,
    updatedTodayNotCreated,
    suspicious,
    rowAmounts,
    assetSideKeys,
    leSideKeys,
    taxForChangedIncome,
  };
}

async function main() {
  const { envFile, allowProduction, tenantId, tenantName, allTenants } =
    parseArgs();
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing non-production URL: ${url}`);
  }
  if (!allowProduction) {
    throw new Error("Pass --allow-production");
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }) as SupabaseClient;

  const tenants = await resolveTenants(
    admin,
    tenantId,
    tenantName,
    allTenants,
  );

  console.log(`\n=== August ${FY} BS + income probe (read-only) ===`);
  console.log(`Today filter: ${TODAY}\n`);

  for (const tenant of tenants) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`${tenant.name} (${tenant.id})`);
    console.log("=".repeat(70));

    const result = await probeTenant(admin, tenant);
    if ("error" in result && result.error) {
      console.log(`ERROR: ${result.error}`);
      continue;
    }

    const {
      bsCheck,
      widgetCheck,
      totalRevenueFromVm,
      totalRevenueDirect,
      augustIncomeCount,
      augustIncomeSum,
      changedToday,
      createdToday,
      updatedTodayNotCreated,
      suspicious,
      rowAmounts,
      taxForChangedIncome,
    } = result as Exclude<typeof result, { error: string }>;

    console.log("\n--- Balance Sheet Check (August) ---");
    console.log(`Total Assets:               GHS ${bsCheck.totalAssets.toFixed(2)}`);
    console.log(
      `Total Liabilities + Equity: GHS ${bsCheck.totalLiabilitiesAndEquity.toFixed(2)}`,
    );
    console.log(
      `Difference (A − L+E):       GHS ${bsCheck.difference.toFixed(2)} ${bsCheck.isBalanced ? "(balanced)" : "(OUT OF BALANCE)"}`,
    );
    if (bsCheck.difference > 0) {
      console.log("  → Assets EXCEED Liabilities+Equity by this amount");
    } else if (bsCheck.difference < 0) {
      console.log("  → Liabilities+Equity EXCEED Assets by this amount");
    }
    console.log(
      `Dashboard widget parity:    diff=${widgetCheck.difference.toFixed(2)} balanced=${widgetCheck.isBalanced}`,
    );

    console.log("\n--- Revenue (August) ---");
    console.log(`Dashboard VM totalRevenue:  GHS ${totalRevenueFromVm?.toFixed(2) ?? "n/a"}`);
    console.log(`Direct sum (income):        GHS ${totalRevenueDirect.toFixed(2)}`);
    console.log(`August income rows:         ${augustIncomeCount}, sum GHS ${augustIncomeSum.toFixed(2)}`);

    if (Math.abs(bsCheck.difference) > 0.001 || changedToday.length > 0) {
      console.log("\n--- BS line items (August, non-zero) ---");
      for (const r of rowAmounts.filter((x) => Math.abs(x.amount) > 0.001)) {
        console.log(`  ${r.label} (${r.key}): GHS ${r.amount.toFixed(2)}`);
      }
    }

    console.log(`\n--- Income register changed today (${TODAY}): ${changedToday.length} row(s) ---`);
    for (const r of changedToday) {
      console.log(JSON.stringify(r, null, 2));
    }
    if (createdToday.length) {
      console.log(`  Created today: ${createdToday.length}`);
    }
    if (updatedTodayNotCreated.length) {
      console.log(`  Updated (not created) today: ${updatedTodayNotCreated.length}`);
    }

    if (suspicious.length) {
      console.log("\n--- Suspicious August income (amount≈36.90 or mis-shaped system adj) ---");
      for (const r of suspicious) {
        console.log(JSON.stringify(r, null, 2));
      }
    }

    if (taxForChangedIncome?.length) {
      console.log("\n--- Tax ledger linked to today's changed income ---");
      console.log(JSON.stringify(taxForChangedIncome, null, 2));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
