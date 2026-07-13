import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import FinanceNav from "../finance-nav";
import ProfitLoss from "../profit-loss";
import { buildProfitLossReport } from "../profit-loss-utils";

export default async function ProfitLossPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: fixedAssets, error: fixedAssetsError },
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select("date, service_category, amount")
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select("date, expense_category, sub_category, amount")
      .order("date", { ascending: true }),
    supabase
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .order("asset_id", { ascending: true }),
  ]);

  const fetchError =
    incomeError?.message ??
    expenseError?.message ??
    fixedAssetsError?.message ??
    null;

  const report = buildProfitLossReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Profit &amp; Loss
      </h2>
      <ProfitLoss report={report} fetchError={fetchError} />
    </div>
  );
}
