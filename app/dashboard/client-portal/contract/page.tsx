import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserClientId } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createTenantLogosSignedUrl } from "@/utils/tenant-logos-storage";
import {
  SERVICE_CONTRACT_LINE_ITEM_SELECT,
  SERVICE_CONTRACT_PORTAL_LIST_SELECT,
  toNumber,
  type ServiceContractLineItemRow,
  type ServiceContractPortalListRow,
} from "@/utils/service-contracts-types";
import ClientPortalShell from "../client-portal-shell";
import MyContracts, { type ClientPortalContractCard } from "../my-contracts";

export default async function ClientPortalContractPage() {
  const clientId = await getCurrentUserClientId();

  if (!clientId) {
    return (
      <ClientPortalShell sectionTitle="My Contract">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your user account is not linked to a customer record.
        </div>
      </ClientPortalShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("service_contracts")
    .select(SERVICE_CONTRACT_PORTAL_LIST_SELECT)
    .order("start_date", { ascending: false });

  const contracts = (data as ServiceContractPortalListRow[] | null) ?? [];
  const contractIds = contracts.map((contract) => contract.id);

  let lineItemsByContractId: Record<string, ServiceContractLineItemRow[]> = {};

  if (contractIds.length > 0) {
    const { data: lineItems } = await supabase
      .from("service_contract_line_items")
      .select(SERVICE_CONTRACT_LINE_ITEM_SELECT)
      .in("contract_id", contractIds)
      .order("sort_order", { ascending: true });

    lineItemsByContractId = ((lineItems as ServiceContractLineItemRow[] | null) ?? []).reduce<
      Record<string, ServiceContractLineItemRow[]>
    >((acc, line) => {
      const bucket = acc[line.contract_id] ?? [];
      bucket.push({
        ...line,
        labour_amount: toNumber(line.labour_amount),
        material_amount: toNumber(line.material_amount),
        discount_amount: toNumber(line.discount_amount),
        total_cost: toNumber(line.total_cost),
      });
      acc[line.contract_id] = bucket;
      return acc;
    }, {});
  }

  const admin = createAdminClient();
  const portalContracts: ClientPortalContractCard[] = await Promise.all(
    contracts.map(async (contract) => {
      const documentPath = contract.document_url?.trim();
      let documentSignedUrl: string | null = null;
      if (documentPath) {
        documentSignedUrl =
          (await createTenantLogosSignedUrl(admin, documentPath)) ?? documentPath;
      }

      return {
        id: contract.id,
        contract_number: contract.contract_number,
        start_date: contract.start_date,
        end_date: contract.end_date,
        billing_frequency: contract.billing_frequency,
        status: contract.status,
        subtotal: toNumber(contract.subtotal),
        total_amount_due: toNumber(contract.total_amount_due),
        document_url: contract.document_url,
        document_signed_url: documentSignedUrl,
        line_items: lineItemsByContractId[contract.id] ?? [],
      };
    }),
  );

  return (
    <ClientPortalShell sectionTitle="My Contract">
      <MyContracts contracts={portalContracts} fetchError={error?.message ?? null} />
    </ClientPortalShell>
  );
}
