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
import FinanceNav from "../finance-nav";
import {
  SUPPLIER_CONTRACT_LIST_SELECT,
  normalizeSupplierContractListRow,
  type SupplierContractListRow,
} from "@/utils/supplier-contracts-types";
import SupplierContractsList from "./supplier-contracts-list";

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

  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("supplier_contracts")
      .select(SUPPLIER_CONTRACT_LIST_SELECT)
      .eq("tenant_id", tenantId),
    buScope,
  )
    .order("start_date", { ascending: false })
    .order("contract_sequence", { ascending: false });

  const contracts = ((data as SupplierContractListRow[] | null) ?? []).map(
    normalizeSupplierContractListRow,
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Supplier Contracts</h2>
      <SupplierContractsList
        contracts={contracts}
        fetchError={error?.message ?? null}
      />
    </div>
  );
}
