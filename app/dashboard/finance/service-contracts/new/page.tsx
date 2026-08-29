import { cookies } from "next/headers";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { CLIENT_SELECT, type ClientEntry } from "@/app/dashboard/operations/clients-utils";
import { getActiveBusinessUnitId, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { loadTenantSalesTaxBasis } from "@/app/dashboard/finance/tax-utils";
import { peekNextServiceContractNumber } from "@/utils/service-contracts-api";
import { defaultServiceContractFormState } from "@/utils/service-contracts-types";
import FinanceNav from "../../finance-nav";
import ServiceContractForm from "../service-contract-form";

export default async function NewServiceContractPage() {
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
    { data: customers, error: customersError },
    nextContractNumberResult,
    salesTaxBasisResult,
  ] = await Promise.all([
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", { ascending: true }),
    peekNextServiceContractNumber(supabase, tenantId),
    loadTenantSalesTaxBasis(supabase, tenantId, activeBusinessUnitId),
  ]);

  const salesTaxBasis = salesTaxBasisResult.salesTaxBasis;
  const fetchError =
    customersError?.message ??
    nextContractNumberResult.error ??
    salesTaxBasisResult.error ??
    null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-[#0f2744]">New Service Contract</h2>
        <Link
          href="/dashboard/finance/service-contracts"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <ServiceContractForm
        mode="create"
        nextContractNumberPreview={nextContractNumberResult.contractNumber}
        initialCustomers={(customers as ClientEntry[] | null) ?? []}
        initialForm={defaultServiceContractFormState(20, 7.5, salesTaxBasis)}
        salesTaxBasis={salesTaxBasis}
        fetchError={fetchError}
      />
    </div>
  );
}
