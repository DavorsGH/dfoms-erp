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
import {
  CONTRACT_PROJECT_SELECT,
  type ContractProjectOption,
} from "../../../administration/projects-utils";
import FinanceNav from "../../finance-nav";
import SupplierContractDetailView from "../supplier-contract-detail-view";

export default async function SupplierContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  const { data: projects } = await applyBusinessUnitScope(
    supabase
      .from("projects")
      .select(CONTRACT_PROJECT_SELECT)
      .eq("tenant_id", tenantId),
    buScope,
  ).order("project_name", { ascending: true });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Supplier Contract</h2>
      <SupplierContractDetailView
        contractId={id}
        initialProjects={(projects as ContractProjectOption[] | null) ?? []}
      />
    </div>
  );
}
