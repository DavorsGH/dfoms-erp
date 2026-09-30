import ClientPortalShell from "../../client-portal-shell";
import ClientReceiptView from "@/app/dashboard/finance/client-receipts/client-receipt-view";
import { getCurrentTenantBillingSettingsHeader } from "@/utils/billing-settings-load";

type ClientPortalReceiptPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ClientPortalReceiptPage({
  params,
}: ClientPortalReceiptPageProps) {
  const { id } = await params;
  const billingSettings = await getCurrentTenantBillingSettingsHeader();

  return (
    <ClientPortalShell sectionTitle="Receipt">
      <ClientReceiptView
        receiptId={id}
        billingSettings={billingSettings}
        backHref="/dashboard/client-portal/receipts"
        backLabel="Back to receipts"
      />
    </ClientPortalShell>
  );
}
