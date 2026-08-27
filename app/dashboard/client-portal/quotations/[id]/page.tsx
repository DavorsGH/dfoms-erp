import ClientPortalShell from "../../client-portal-shell";
import ClientQuotationView from "@/app/dashboard/sales-crm/quotations/client-quotation-view";
import { getCurrentTenantBillingSettingsHeader, getCurrentTenantGraTin } from "@/utils/billing-settings-load";

type ClientPortalQuotationPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ClientPortalQuotationPage({
  params,
}: ClientPortalQuotationPageProps) {
  const { id } = await params;
  const [billingSettings, graTin] = await Promise.all([
    getCurrentTenantBillingSettingsHeader(),
    getCurrentTenantGraTin(),
  ]);

  return (
    <ClientPortalShell sectionTitle="Quotation">
      <ClientQuotationView
        quotationId={id}
        billingSettings={billingSettings}
        graTin={graTin}
        backHref="/dashboard/client-portal/quotations"
        backLabel="Back to quotations"
        showStaffActions={false}
        portalQuotationDates
      />
    </ClientPortalShell>
  );
}
