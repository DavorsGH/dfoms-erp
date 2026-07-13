import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  calculateAssetAccumulatedDepreciationAsOf,
  calculateAssetNetBookValueAsOf,
  calculateTotalCost,
  getAssetMonthlyDepreciationAmount,
  getFinancialYearMonthEnd,
} from "../app/dashboard/finance/fixed-assets-utils";

function loadEnvFile(filePath: string) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase credentials in .env.local");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: assets, error } = await admin
    .from("fixed_assets")
    .select(
      "asset_id, asset_name, purchase_date, original_cost, quantity, useful_life_years, depreciation_method, total_cost",
    )
    .order("asset_id", { ascending: true });

  if (error) throw new Error(error.message);

  const financialYear = 2026;
  const decMonthEnd = getFinancialYearMonthEnd(financialYear, 11);
  const novMonthEnd = getFinancialYearMonthEnd(financialYear, 10);

  console.log(`December 2026 month-end: ${decMonthEnd}`);
  console.log(`November 2026 month-end: ${novMonthEnd}`);
  console.log(`Asset count: ${assets?.length ?? 0}\n`);

  type Row = {
    asset_id: string;
    asset_name: string;
    purchase_date: string;
    useful_life_years: number;
    depreciation_method: string;
    total_cost: number;
    accum_nov: number;
    accum_dec: number;
    dec_monthly_uncapped: number;
    dec_dep_effective_capped: number;
    nbv_nov: number;
    nbv_dec: number;
    nbv_delta: number;
    pnl_vs_nbv_gap: number;
    cap_applied_in_dec: boolean;
    fully_depreciated_dec: boolean;
  };

  const rows: Row[] = [];
  let totalDecMonthlyUncapped = 0;
  let totalDecMonthlyEffective = 0;
  let totalNbvNov = 0;
  let totalNbvDec = 0;

  for (const asset of assets ?? []) {
    const assetInput = {
      original_cost: Number(asset.original_cost) || 0,
      quantity: Number(asset.quantity) || 0,
      useful_life_years: Number(asset.useful_life_years) || 0,
      purchase_date: asset.purchase_date,
      depreciation_method: asset.depreciation_method ?? "",
    };

    const totalCost = calculateTotalCost(
      assetInput.original_cost,
      assetInput.quantity,
    );
    const accumNov = calculateAssetAccumulatedDepreciationAsOf(
      assetInput,
      novMonthEnd,
    );
    const accumDec = calculateAssetAccumulatedDepreciationAsOf(
      assetInput,
      decMonthEnd,
    );
    const decMonthly = getAssetMonthlyDepreciationAmount(assetInput, decMonthEnd);
    const nbvNov = calculateAssetNetBookValueAsOf(assetInput, novMonthEnd);
    const nbvDec = calculateAssetNetBookValueAsOf(assetInput, decMonthEnd);

    const effectiveDecDep = round2(accumDec - accumNov);
    const nbvDelta = round2(nbvNov - nbvDec);
    const pnlVsNbvGap = round2(decMonthly - effectiveDecDep);
    const capApplied =
      decMonthly > 0.000001 &&
      (Math.abs(pnlVsNbvGap) > 0.001 || effectiveDecDep < decMonthly - 0.001);

    totalDecMonthlyUncapped += decMonthly;
    totalDecMonthlyEffective += effectiveDecDep;
    totalNbvNov += nbvNov;
    totalNbvDec += nbvDec;

    rows.push({
      asset_id: asset.asset_id,
      asset_name: asset.asset_name,
      purchase_date: asset.purchase_date?.slice(0, 10) ?? "",
      useful_life_years: assetInput.useful_life_years,
      depreciation_method: assetInput.depreciation_method,
      total_cost: round2(totalCost),
      accum_nov: round2(accumNov),
      accum_dec: round2(accumDec),
      dec_monthly_uncapped: round2(decMonthly),
      dec_dep_effective_capped: effectiveDecDep,
      nbv_nov: round2(nbvNov),
      nbv_dec: round2(nbvDec),
      nbv_delta: nbvDelta,
      pnl_vs_nbv_gap: pnlVsNbvGap,
      cap_applied_in_dec: capApplied,
      fully_depreciated_dec:
        round2(nbvDec) === 0 && round2(accumDec) >= round2(totalCost) - 0.001,
    });
  }

  console.log("PER-ASSET DECEMBER 2026 BREAKDOWN");
  console.log("=".repeat(120));
  for (const row of rows) {
    console.log(JSON.stringify(row));
  }

  const shortLife = rows.filter((r) => r.useful_life_years <= 1);
  console.log("\n--- ASSETS WITH useful_life_years <= 1 ---");
  if (shortLife.length === 0) {
    console.log("None");
  } else {
    for (const row of shortLife) {
      console.log(
        `${row.asset_id} | ${row.asset_name} | life=${row.useful_life_years}y | total=${row.total_cost} | cap=${row.cap_applied_in_dec} | gap=${row.pnl_vs_nbv_gap}`,
      );
    }
  }

  const cappedRows = rows.filter((r) => r.cap_applied_in_dec);
  console.log(`\n--- ASSETS WITH CAP DIVERGENCE IN DECEMBER (${cappedRows.length}) ---`);
  for (const row of cappedRows) {
    console.log(
      `${row.asset_id} | ${row.asset_name} | uncapped=${row.dec_monthly_uncapped} | effective=${row.dec_dep_effective_capped} | gap=${row.pnl_vs_nbv_gap} | nbv_dec=${row.nbv_dec}`,
    );
  }

  console.log("\n--- PORTFOLIO TOTALS (December 2026) ---");
  console.log(
    JSON.stringify(
      {
        total_dec_monthly_uncapped_pnl_path: round2(totalDecMonthlyUncapped),
        total_dec_dep_effective_capped_nbv_path: round2(totalDecMonthlyEffective),
        december_pnl_vs_nbv_gap: round2(
          totalDecMonthlyUncapped - totalDecMonthlyEffective,
        ),
        total_nbv_nov: round2(totalNbvNov),
        total_nbv_dec: round2(totalNbvDec),
        total_nbv_delta: round2(totalNbvNov - totalNbvDec),
      },
      null,
      2,
    ),
  );

  console.log("\n--- MONTHLY P&L vs NBV DEPRECIATION GAP (Jul-Dec 2026) ---");
  for (let monthIndex = 6; monthIndex <= 11; monthIndex += 1) {
    const monthEnd = getFinancialYearMonthEnd(financialYear, monthIndex);
    const priorMonthEnd =
      monthIndex === 0 ? null : getFinancialYearMonthEnd(financialYear, monthIndex - 1);
    let pnlDep = 0;
    let nbvDelta = 0;

    for (const asset of assets ?? []) {
      const assetInput = {
        original_cost: Number(asset.original_cost) || 0,
        quantity: Number(asset.quantity) || 0,
        useful_life_years: Number(asset.useful_life_years) || 0,
        purchase_date: asset.purchase_date,
        depreciation_method: asset.depreciation_method ?? "",
      };
      pnlDep += getAssetMonthlyDepreciationAmount(assetInput, monthEnd);
      if (priorMonthEnd) {
        const nbvPrior = calculateAssetNetBookValueAsOf(assetInput, priorMonthEnd);
        const nbvCurrent = calculateAssetNetBookValueAsOf(assetInput, monthEnd);
        nbvDelta += nbvPrior - nbvCurrent;
      }
    }

    console.log(
      `${monthEnd}: pnl=${round2(pnlDep)} nbv_delta=${round2(nbvDelta)} gap=${round2(pnlDep - nbvDelta)}`,
    );
  }

  const affectedIds = ["DF0003", "DF0006", "DF0008", "DF0009"];
  console.log("\n--- AFFECTED ASSETS: DECEMBER 2026 MONTHLY CHARGE ---");
  for (const row of rows.filter((r) => affectedIds.includes(r.asset_id))) {
    console.log(
      `${row.asset_id}: dec_monthly=${row.dec_monthly_uncapped} (should be 0.00)`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
