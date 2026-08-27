import ClientPortalShell from "../../client-portal-shell";
import ClientReceiptView from "@/app/dashboard/finance/client-receipts/client-receipt-view";
import { getCurrentTenantBillingSettingsHeader, getCurrentTenantGraTin } from "@/utils/billing-settings-load";

type ClientPortalReceiptPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ClientPortalReceiptPage({
  params,
}: ClientPortalReceiptPageProps) {
  const { id } = await params;
  const [billingSettings, graTin] = await Promise.all([
    getCurrentTenantBillingSettingsHeader(),
    getCurrentTenantGraTin(),
  ]);

  return (
    <ClientPortalShell sectionTitle="Receipt">
      <ClientReceiptView
        receiptId={id}
        billingSettings={billingSettings}
        graTin={graTin}
        backHref="/dashboard/client-portal/receipts"
        backLabel="Back to receipts"
      />
    </ClientPortalShell>
  );
}
