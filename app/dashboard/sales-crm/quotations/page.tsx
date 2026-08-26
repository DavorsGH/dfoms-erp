import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  CLIENT_QUOTATION_LIST_SELECT,
  normalizeClientQuotationListRow,
  type ClientQuotationListRow,
} from "@/utils/client-quotations-types";
import { loadActiveServiceContractsByClientId } from "@/utils/service-contracts-api";
import CrmShell from "@/app/dashboard/crm/crm-shell";
import ClientQuotationsList from "./client-quotations-list";

export default async function ClientQuotationsPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <CrmShell sectionTitle="Quotations">
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </CrmShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, activeContractByClientId] = await Promise.all([
    supabase
      .from("client_quotations")
      .select(CLIENT_QUOTATION_LIST_SELECT)
      .eq("tenant_id", tenantId)
      .order("issue_date", { ascending: false })
      .order("quotation_sequence", { ascending: false }),
    loadActiveServiceContractsByClientId(supabase, tenantId),
  ]);

  return (
    <CrmShell sectionTitle="Quotations">
      <ClientQuotationsList
        initialQuotations={
          ((data as ClientQuotationListRow[] | null) ?? []).map(
            normalizeClientQuotationListRow,
          )
        }
        fetchError={error?.message ?? null}
        activeContractByClientId={activeContractByClientId}
      />
    </CrmShell>
  );
}
