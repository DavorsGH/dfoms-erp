import ClientPortalShell from "../../client-portal-shell";
import ClientInvoiceView from "@/app/dashboard/finance/client-invoices/client-invoice-view";
import { getCurrentTenantBillingSettingsHeader, getCurrentTenantGraTin } from "@/utils/billing-settings-load";

type ClientPortalInvoicePageProps = {
  params: Promise<{ id: string }>;
};

export default async function ClientPortalInvoicePage({
  params,
}: ClientPortalInvoicePageProps) {
  const { id } = await params;
  const [billingSettings, graTin] = await Promise.all([
    getCurrentTenantBillingSettingsHeader(),
    getCurrentTenantGraTin(),
  ]);

  return (
    <ClientPortalShell sectionTitle="Invoice">
      <ClientInvoiceView
        invoiceId={id}
        billingSettings={billingSettings}
        graTin={graTin}
        paymentMethods={[]}
        backHref="/dashboard/client-portal/invoices"
        backLabel="Back to invoices"
        showStaffActions={false}
      />
    </ClientPortalShell>
  );
}
