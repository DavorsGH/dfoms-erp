import ClientPortalShell from "../../client-portal-shell";
import ClientQuotationView from "@/app/dashboard/sales-crm/quotations/client-quotation-view";
import { getCurrentTenantBillingSettingsHeader } from "@/utils/billing-settings-load";

type ClientPortalQuotationPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ClientPortalQuotationPage({
  params,
}: ClientPortalQuotationPageProps) {
  const { id } = await params;
  const billingSettings = await getCurrentTenantBillingSettingsHeader();

  return (
    <ClientPortalShell sectionTitle="Quotation">
      <ClientQuotationView
        quotationId={id}
        billingSettings={billingSettings}
        backHref="/dashboard/client-portal/quotations"
        backLabel="Back to quotations"
        showStaffActions={false}
      />
    </ClientPortalShell>
  );
}
