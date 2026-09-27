import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import type { NamedLookup } from "@/app/dashboard/lookup-types";
import FinanceNav from "../finance-nav";
import { queryExpenseSubcategoryLookups } from "../expense-register-utils";
import {
  SUPPLIER_CONTRACT_LIST_SELECT,
  normalizeSupplierContractListRow,
  type SupplierContractListRow,
} from "@/utils/supplier-contracts-types";
import SupplierContractsWorkspace from "./supplier-contracts-workspace";

export default async function SupplierContractsPage() {
  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
        <FinanceNav />
        <p className="text-sm text-red-700">Unable to resolve workspace.</p>
      </div>
    );
  }

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
    { data, error },
    { data: expenseCategories },
    { data: expenseSubcategories },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("supplier_contracts")
        .select(SUPPLIER_CONTRACT_LIST_SELECT)
        .eq("tenant_id", tenantId),
      buScope,
    )
      .order("start_date", { ascending: false })
      .order("contract_sequence", { ascending: false }),
    supabase.from("expense_categories").select("name").order("name"),
    queryExpenseSubcategoryLookups(supabase),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Supplier Contracts</h2>
      {error ? (
        <p className="mb-4 text-sm text-red-700">{error.message}</p>
      ) : null}
      <SupplierContractsWorkspace
        initialContracts={((data as SupplierContractListRow[] | null) ?? []).map(
          normalizeSupplierContractListRow,
        )}
        expenseCategories={(expenseCategories as NamedLookup[] | null) ?? []}
        expenseSubcategories={(expenseSubcategories as NamedLookup[] | null) ?? []}
      />
    </div>
  );
}
