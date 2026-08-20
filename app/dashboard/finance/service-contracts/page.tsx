import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  SERVICE_CONTRACT_LIST_SELECT,
  normalizeServiceContractListRow,
  type ServiceContractListRow,
} from "@/utils/service-contracts-types";
import FinanceNav from "../finance-nav";
import ServiceContractsList from "./service-contracts-list";

export default async function ServiceContractsPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
        <FinanceNav />
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </div>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("service_contracts")
    .select(SERVICE_CONTRACT_LIST_SELECT)
    .eq("tenant_id", tenantId)
    .order("start_date", { ascending: false })
    .order("contract_sequence", { ascending: false });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Service Contracts</h2>
      <ServiceContractsList
        initialContracts={
          ((data as ServiceContractListRow[] | null) ?? []).map(
            normalizeServiceContractListRow,
          )
        }
        fetchError={error?.message ?? null}
      />
    </div>
  );
}
