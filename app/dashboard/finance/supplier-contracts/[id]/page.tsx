import FinanceNav from "../../finance-nav";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
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

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Supplier Contract</h2>
      <SupplierContractDetailView contractId={id} />
    </div>
  );
}
