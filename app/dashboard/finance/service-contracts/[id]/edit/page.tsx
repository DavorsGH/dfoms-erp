import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { CLIENT_SELECT, type ClientEntry } from "@/app/dashboard/operations/clients-utils";
import { getActiveBusinessUnitId, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { loadTenantSalesTaxBasis } from "@/app/dashboard/finance/tax-utils";
import { loadServiceContractDetail } from "@/utils/service-contracts-api";
import {
  serviceContractToFormState,
  type ServiceContractLineItemRow,
} from "@/utils/service-contracts-types";
import { createAdminClient } from "@/utils/supabase/admin";
import { createTenantLogosSignedUrl } from "@/utils/tenant-logos-storage";
import FinanceNav from "../../../finance-nav";
import ServiceContractForm from "../../service-contract-form";

type EditServiceContractPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditServiceContractPage({
  params,
}: EditServiceContractPageProps) {
  const { id } = await params;
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
  const activeBusinessUnitId = await getActiveBusinessUnitId();

  const [
    detail,
    { data: customers, error: customersError },
    salesTaxBasisResult,
  ] = await Promise.all([
    loadServiceContractDetail(supabase, tenantId, id),
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", { ascending: true }),
    loadTenantSalesTaxBasis(supabase, tenantId, activeBusinessUnitId),
  ]);

  if (!detail.contract) {
    notFound();
  }

  const fetchError =
    detail.error ??
    customersError?.message ??
    salesTaxBasisResult.error ??
    null;

  const initialForm = serviceContractToFormState(
    detail.contract,
    (detail.line_items as ServiceContractLineItemRow[]) ?? [],
  );

  let initialDocumentSignedUrl: string | null = null;
  const documentPath = detail.contract.document_url?.trim();
  if (documentPath) {
    const admin = createAdminClient();
    initialDocumentSignedUrl =
      (await createTenantLogosSignedUrl(admin, documentPath)) ?? documentPath;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-[#0f2744]">
          Edit {detail.contract.contract_number}
        </h2>
        <Link
          href={`/dashboard/finance/service-contracts/${id}`}
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to contract
        </Link>
      </div>
      <ServiceContractForm
        mode="edit"
        contractId={id}
        existingContractNumber={detail.contract.contract_number}
        initialCustomers={(customers as ClientEntry[] | null) ?? []}
        initialForm={initialForm}
        salesTaxBasis={salesTaxBasisResult.salesTaxBasis}
        initialDocumentSignedUrl={initialDocumentSignedUrl}
        fetchError={fetchError}
      />
    </div>
  );
}
