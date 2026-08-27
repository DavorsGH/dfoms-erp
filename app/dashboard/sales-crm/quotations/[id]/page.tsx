import type { AppRole } from "@/app/dashboard/user-account-types";
import CrmShell from "@/app/dashboard/crm/crm-shell";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserRole, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { canAccessFinanceSection } from "@/utils/rbac-access";
import { getCurrentTenantBillingSettingsHeader, getCurrentTenantGraTin } from "@/utils/billing-settings-load";
import { findActiveServiceContractForClient } from "@/utils/service-contracts-api";
import ClientQuotationView from "../client-quotation-view";

type ViewClientQuotationPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ViewClientQuotationPage({
  params,
}: ViewClientQuotationPageProps) {
  const { id } = await params;
  const tenantId = await getCurrentUserTenantId();
  const [billingSettings, graTin, role] = await Promise.all([
    getCurrentTenantBillingSettingsHeader(),
    getCurrentTenantGraTin(),
    getCurrentUserRole(),
  ]);

  let customerActiveContract = null;
  if (tenantId) {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data } = await supabase
      .from("client_quotations")
      .select("client_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (data?.client_id) {
      customerActiveContract = await findActiveServiceContractForClient(
        supabase,
        tenantId,
        data.client_id,
      );
    }
  }

  const canConvertToInvoice = canAccessFinanceSection(role as AppRole | null);

  return (
    <CrmShell sectionTitle="Quotation">
      <ClientQuotationView
        quotationId={id}
        billingSettings={billingSettings}
        graTin={graTin}
        canConvertToInvoice={canConvertToInvoice}
        customerActiveContract={customerActiveContract}
      />
    </CrmShell>
  );
}
