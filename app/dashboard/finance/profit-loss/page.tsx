import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import { buildAvailableYears } from "../finance-year-utils";
import FinanceNav from "../finance-nav";
import ProfitLoss from "../profit-loss";

export default async function ProfitLossPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: fixedAssets, error: fixedAssetsError },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("income_register")
        .select(
          "date, service_category, amount, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
        ),
      buScope,
    ).order("date", { ascending: true }),
    applyBusinessUnitScope(
      supabase
        .from("expense_register")
        .select(
          "date, expense_category, sub_category, amount, net_of_tax_amount, input_vat_amount",
        ),
      buScope,
    ).order("date", { ascending: true }),
    applyBusinessUnitScope(
      supabase
        .from("fixed_assets")
        .select(
          "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
        ),
      buScope,
    ).order("asset_id", { ascending: true }),
  ]);

  const fetchError =
    incomeError?.message ??
    expenseError?.message ??
    fixedAssetsError?.message ??
    null;

  const availableYears = buildAvailableYears(
    (incomeEntries ?? []).map((entry) => entry.date),
    (expenseEntries ?? []).map((entry) => entry.date),
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Profit &amp; Loss
      </h2>
      <ProfitLoss
        initialIncomeEntries={incomeEntries ?? []}
        initialExpenseEntries={expenseEntries ?? []}
        initialFixedAssets={fixedAssets ?? []}
        availableYears={availableYears}
        fetchError={fetchError}
      />
    </div>
  );
}
