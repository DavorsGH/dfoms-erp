import type { AppRole } from "@/app/dashboard/user-account-types";
import CrmShell from "@/app/dashboard/crm/crm-shell";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import { canAccessFinanceSection } from "@/utils/rbac-access";
import { getCurrentTenantBillingSettingsHeader } from "@/utils/billing-settings-load";
import ClientQuotationView from "../client-quotation-view";

type ViewClientQuotationPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ViewClientQuotationPage({
  params,
}: ViewClientQuotationPageProps) {
  const { id } = await params;
  const [billingSettings, role] = await Promise.all([
    getCurrentTenantBillingSettingsHeader(),
    getCurrentUserRole(),
  ]);

  const canConvertToInvoice = canAccessFinanceSection(role as AppRole | null);

  return (
    <CrmShell sectionTitle="Quotation">
      <ClientQuotationView
        quotationId={id}
        billingSettings={billingSettings}
        canConvertToInvoice={canConvertToInvoice}
      />
    </CrmShell>
  );
}
