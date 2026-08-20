import FinanceNav from "../../finance-nav";
import ServiceContractView from "../service-contract-view";

type ServiceContractDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ServiceContractDetailPage({
  params,
}: ServiceContractDetailPageProps) {
  const { id } = await params;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <ServiceContractView contractId={id} />
    </div>
  );
}
