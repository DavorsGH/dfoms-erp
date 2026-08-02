/**
 * One-off VERIFY ONLY: second-tenant depreciation-in-Total-Expenses check.
 * Usage: npx tsx scripts/_tmp-verify-expense-dep-tenant2.ts
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildDashboardViewModel } from "../app/dashboard/dashboard-utils";
import { buildProfitLossReport } from "../app/dashboard/finance/profit-loss-utils";
import type { InventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const YEAR = 2026;
const MONTH = 8; // August
const MONTH_KEY = "2026-08";

function loadEnv(file: string) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
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
  return Math.round(n * 100) / 100;
}

type AssetRow = {
  tenant_id: string;
  asset_id?: string | null;
  asset_name?: string | null;
  original_cost: number | null;
  quantity: number | null;
  useful_life_years: number | null;
  purchase_date: string;
  depreciation_method: string | null;
};

function depForAssets(assets: AssetRow[], year: number, monthIndex: number) {
  const report = buildProfitLossReport(
    [],
    [],
    assets.map((a) => ({
      original_cost: Number(a.original_cost) || 0,
      quantity: Number(a.quantity) || 0,
      useful_life_years: Number(a.useful_life_years) || 0,
      purchase_date: String(a.purchase_date),
      depreciation_method: String(a.depreciation_method ?? ""),
    })),
    year,
  );
  const month = report.rows.find((r) => r.key === "depreciation")!.amounts[monthIndex];
  let ytd = 0;
  for (let m = 0; m <= monthIndex; m += 1) {
    ytd += report.rows.find((r) => r.key === "depreciation")!.amounts[m];
  }
  return { month: r2(month), ytd: r2(ytd) };
}

async function computeTenant(
  sb: SupabaseClient,
  tid: string,
  tenantLabel: string,
) {
  const [
    { data: income, error: incomeError },
    { data: expenses, error: expenseError },
    { data: assets, error: assetsError },
  ] = await Promise.all([
    sb.from("income_register").select("*").eq("tenant_id", tid),
    sb.from("expense_register").select("*").eq("tenant_id", tid),
    sb
      .from("fixed_assets")
      .select(
        "tenant_id, asset_id, asset_name, original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", tid),
  ]);

  if (incomeError || expenseError || assetsError) {
    throw new Error(
      incomeError?.message ?? expenseError?.message ?? assetsError?.message,
    );
  }

  const incomeEntries = (income ?? []).map((e) => ({
    date: String(e.date),
    amount: Number(e.amount) || 0,
  }));
  const expenseEntries = (expenses ?? []).map((e) => ({
    date: String(e.date),
    amount: Number(e.amount) || 0,
  }));
  const assetInputs = (assets ?? []).map((a) => ({
    original_cost: Number(a.original_cost) || 0,
    quantity: Number(a.quantity) || 0,
    useful_life_years: Number(a.useful_life_years) || 0,
    purchase_date: String(a.purchase_date),
    depreciation_method: String(a.depreciation_method ?? ""),
  }));

  const emptyInv: InventoryBalanceSheetInput = {
    cashPurchases: [],
    productCashPurchases: [],
    rawMaterials: [],
    finishedProducts: [],
    productSales: [],
  };

  const pl = buildProfitLossReport(
    (income ?? []).map((e) => ({
      date: String(e.date),
      service_category: e.service_category,
      amount: Number(e.amount) || 0,
      entry_type: e.entry_type,
      sale_status: e.sale_status,
      net_of_tax_amount: e.net_of_tax_amount,
      output_vat_amount: e.output_vat_amount,
    })),
    (expenses ?? []).map((e) => ({
      date: String(e.date),
      expense_category: e.expense_category,
      sub_category: e.sub_category,
      amount: Number(e.amount) || 0,
      net_of_tax_amount: e.net_of_tax_amount,
      input_vat_amount: e.input_vat_amount,
    })),
    assetInputs,
    YEAR,
  );

  const monthIndex = MONTH - 1;
  const plDep = pl.rows.find((r) => r.key === "depreciation")!.amounts[monthIndex];
  let plDepYtd = 0;
  for (let m = 0; m <= monthIndex; m += 1) {
    plDepYtd += pl.rows.find((r) => r.key === "depreciation")!.amounts[m];
  }

  const beforeRegisterMonth = expenseEntries
    .filter((e) =>
      e.date.startsWith(`${YEAR}-${String(MONTH).padStart(2, "0")}`),
    )
    .reduce((s, e) => s + e.amount, 0);
  const beforeRegisterYtd = expenseEntries
    .filter((e) => {
      const y = Number(e.date.slice(0, 4));
      const m = Number(e.date.slice(5, 7));
      return y === YEAR && m >= 1 && m <= MONTH;
    })
    .reduce((s, e) => s + e.amount, 0);

  const vm = buildDashboardViewModel({
    incomeEntries,
    profitLossIncomeEntries: (income ?? []).map((e) => ({
      date: String(e.date),
      service_category: e.service_category,
      amount: Number(e.amount) || 0,
      entry_type: e.entry_type,
      sale_status: e.sale_status,
      net_of_tax_amount: e.net_of_tax_amount,
      output_vat_amount: e.output_vat_amount,
    })),
    balanceSheetIncomeEntries: (income ?? []).map((e) => ({
      date: String(e.date),
      amount: Number(e.amount) || 0,
      amount_received: Number(e.amount_received) || 0,
      payment_status: e.payment_status,
      wht_amount: Number(e.wht_amount) || 0,
      net_of_tax_amount: e.net_of_tax_amount,
      output_vat_amount: e.output_vat_amount,
    })),
    expenseEntries,
    profitLossExpenseEntries: (expenses ?? []).map((e) => ({
      date: String(e.date),
      expense_category: e.expense_category,
      sub_category: e.sub_category,
      amount: Number(e.amount) || 0,
      net_of_tax_amount: e.net_of_tax_amount,
      input_vat_amount: e.input_vat_amount,
    })),
    fixedAssets: assetInputs,
    payableEntries: [],
    capitalContributions: [],
    cashFlowIncomeEntries: [],
    cashFlowExpenseEntries: [],
    payrollHistoryWages: [],
    monthEndCloseNetPay: [],
    manualEntries: [],
    monthEndCloseRecords: [],
    payrollProcessingEntries: [],
    payrollHistoryEntries: [],
    inventoryBalanceSheetInput: emptyInv,
    taxLedgerEntries: [],
    referenceDate: new Date("2026-08-02T12:00:00"),
  });

  const snap = vm.monthSnapshots[MONTH_KEY]?.summary;
  if (!snap) {
    return {
      tenantLabel,
      tenantId: tid,
      period: MONTH_KEY,
      assetCount: assetInputs.length,
      assets: (assets ?? []).map((a) => ({
        asset_id: a.asset_id,
        asset_name: a.asset_name,
        purchase_date: a.purchase_date,
      })),
      error: `No month snapshot for ${MONTH_KEY} (no income/expense activity in available months?)`,
      plDepMonth: r2(plDep),
      plDepYtd: r2(plDepYtd),
      before: {
        totalExpensesMonth: r2(beforeRegisterMonth),
        totalExpensesYtd: r2(beforeRegisterYtd),
      },
    };
  }

  const reconMonth = r2(snap.totalRevenue - snap.totalExpenses);
  const reconYtd = r2(snap.totalRevenueYtd - snap.totalExpensesYtd);

  return {
    tenantLabel,
    tenantId: tid,
    period: MONTH_KEY,
    assetCount: assetInputs.length,
    assets: (assets ?? []).map((a) => ({
      asset_id: a.asset_id,
      asset_name: a.asset_name,
      purchase_date: a.purchase_date,
      original_cost: a.original_cost,
      useful_life_years: a.useful_life_years,
    })),
    before: {
      totalExpensesMonth: r2(beforeRegisterMonth),
      totalExpensesYtd: r2(beforeRegisterYtd),
    },
    after: {
      totalExpensesMonth: snap.totalExpenses,
      totalExpensesYtd: snap.totalExpensesYtd,
      depreciationIncluded: snap.depreciationIncluded,
      depreciationIncludedYtd: snap.depreciationIncludedYtd,
      totalRevenueMonth: snap.totalRevenue,
      totalRevenueYtd: snap.totalRevenueYtd,
      netProfitMonth: snap.netProfit,
      netProfitYtd: snap.netProfitYtd,
    },
    reconciliation: {
      revMinusExpMonth: reconMonth,
      netProfitMonth: snap.netProfit,
      deltaMonth: r2(reconMonth - snap.netProfit),
      revMinusExpYtd: reconYtd,
      netProfitYtd: snap.netProfitYtd,
      deltaYtd: r2(reconYtd - snap.netProfitYtd),
    },
    subtitleWouldShow: snap.depreciationIncluded > 0,
    plDepMonth: r2(plDep),
    plDepYtd: r2(plDepYtd),
  };
}

async function main() {
  loadEnv(".env.staging.local");
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) throw new Error("Missing staging URL/service role key");
  if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing non-staging URL (expected ${STAGING_REF})`);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 1) Inventory fixed assets by tenant
  const { data: allAssets, error: allAssetsError } = await sb
    .from("fixed_assets")
    .select(
      "tenant_id, asset_id, asset_name, original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
    );
  if (allAssetsError) throw new Error(allAssetsError.message);

  const { data: tenants, error: tenantsError } = await sb
    .from("tenants")
    .select("id, name, status");
  if (tenantsError) throw new Error(tenantsError.message);

  const tenantName = new Map((tenants ?? []).map((t) => [t.id as string, t.name as string]));
  const byTenant = new Map<string, AssetRow[]>();
  for (const a of (allAssets ?? []) as AssetRow[]) {
    const list = byTenant.get(a.tenant_id) ?? [];
    list.push(a);
    byTenant.set(a.tenant_id, list);
  }

  const monthIndex = MONTH - 1;
  const tenantDepSummary = [...byTenant.entries()].map(([tid, assets]) => {
    const dep = depForAssets(assets, YEAR, monthIndex);
    return {
      tenantId: tid,
      name: tenantName.get(tid) ?? "(unknown)",
      assetCount: assets.length,
      depMonth: dep.month,
      depYtd: dep.ytd,
      assetIds: assets.map((a) => a.asset_id).filter(Boolean),
    };
  });

  const caantaAssets = byTenant.get(CAANTA_TENANT_ID) ?? [];
  const caantaDep = depForAssets(caantaAssets, YEAR, monthIndex);

  let chosenId = CAANTA_TENANT_ID;
  let chosenLabel = tenantName.get(CAANTA_TENANT_ID) ?? "Caanta Market";
  let caantaHadNoAssets = caantaAssets.length === 0 || caantaDep.month === 0;

  if (caantaHadNoAssets) {
    const candidates = tenantDepSummary
      .filter((t) => t.tenantId !== DAVORS_TENANT_ID && t.depMonth > 0)
      .sort((a, b) => b.depMonth - a.depMonth);
    if (candidates.length === 0) {
      console.log(
        JSON.stringify(
          {
            error: "No non-Davors tenant with nonzero Aug 2026 depreciation",
            caanta: {
              tenantId: CAANTA_TENANT_ID,
              assetCount: caantaAssets.length,
              depMonth: caantaDep.month,
              depYtd: caantaDep.ytd,
            },
            tenantDepSummary,
          },
          null,
          2,
        ),
      );
      return;
    }
    chosenId = candidates[0]!.tenantId;
    chosenLabel = candidates[0]!.name;
  }

  const [chosen, davors] = await Promise.all([
    computeTenant(sb, chosenId, chosenLabel),
    computeTenant(sb, DAVORS_TENANT_ID, "Davors Facilities"),
  ]);

  const davorsAssetIds = new Set(
    ((byTenant.get(DAVORS_TENANT_ID) ?? []).map((a) => a.asset_id).filter(Boolean) as string[]),
  );
  const chosenAssetIds = new Set(
    ((byTenant.get(chosenId) ?? []).map((a) => a.asset_id).filter(Boolean) as string[]),
  );
  const overlap = [...chosenAssetIds].filter((id) => davorsAssetIds.has(id));

  console.log(
    JSON.stringify(
      {
        selection: {
          preferred: "Caanta Market",
          caantaTenantId: CAANTA_TENANT_ID,
          caantaAssetCount: caantaAssets.length,
          caantaDepMonth: caantaDep.month,
          caantaDepYtd: caantaDep.ytd,
          caantaHadNoUsableDepreciation: caantaHadNoAssets,
          chosenTenantId: chosenId,
          chosenTenantName: chosenLabel,
        },
        tenantDepSummary,
        chosen,
        davors,
        isolation: {
          davorsAssetCount: davorsAssetIds.size,
          chosenAssetCount: chosenAssetIds.size,
          overlappingAssetIds: overlap,
          depMonthEqual: chosen.plDepMonth === davors.plDepMonth,
          depYtdEqual: chosen.plDepYtd === davors.plDepYtd,
          chosenDepMonth: chosen.plDepMonth,
          davorsDepMonth: davors.plDepMonth,
          chosenDepYtd: chosen.plDepYtd,
          davorsDepYtd: davors.plDepYtd,
          isolationOk:
            overlap.length === 0 &&
            chosen.plDepMonth !== davors.plDepMonth &&
            (chosen as { after?: { depreciationIncluded: number } }).after
              ?.depreciationIncluded !==
              (davors as { after?: { depreciationIncluded: number } }).after
                ?.depreciationIncluded,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
