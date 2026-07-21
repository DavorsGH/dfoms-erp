import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { buildAvailableYears } from "../finance-year-utils";
import { fetchCashFlowInventoryPurchaseInput } from "../balance-sheet-page-data";
import FinanceNav from "../finance-nav";
import CashFlow from "../cash-flow";

export default async function CashFlowPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: manualEntries, error: manualError },
    inventoryPurchases,
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select("date, amount_received")
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select("date, sub_category, amount, payment_status")
      .order("date", { ascending: true }),
    supabase
      .from("manual_financial_entries")
      .select("*")
      .order("period_month", { ascending: true }),
    fetchCashFlowInventoryPurchaseInput(supabase, tenantId),
  ]);

  const fetchError =
    incomeError?.message ??
    expenseError?.message ??
    manualError?.message ??
    null;

  const availableYears = buildAvailableYears(
    (incomeEntries ?? []).map((entry) => entry.date),
    (expenseEntries ?? []).map((entry) => entry.date),
    (manualEntries ?? []).map((entry) => entry.period_month),
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Cash Flow</h2>
      <CashFlow
        initialIncomeEntries={incomeEntries ?? []}
        initialExpenseEntries={expenseEntries ?? []}
        initialManualEntries={manualEntries ?? []}
        initialInventoryPurchases={inventoryPurchases}
        availableYears={availableYears}
        fetchError={fetchError}
      />
    </div>
  );
}
