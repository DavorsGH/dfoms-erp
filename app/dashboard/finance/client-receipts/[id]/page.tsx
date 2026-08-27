import FinanceNav from "../../finance-nav";
import ClientReceiptView from "../client-receipt-view";
import { getCurrentTenantBillingSettingsHeader, getCurrentTenantGraTin } from "@/utils/billing-settings-load";

type ViewClientReceiptPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ViewClientReceiptPage({
  params,
}: ViewClientReceiptPageProps) {
  const { id } = await params;
  const [billingSettings, graTin] = await Promise.all([
    getCurrentTenantBillingSettingsHeader(),
    getCurrentTenantGraTin(),
  ]);

  return (
    <div>
      <h1 className="no-print mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <div className="no-print">
        <FinanceNav />
      </div>
      <h2 className="no-print mb-6 text-xl font-semibold text-[#0f2744]">
        Customer Receipt
      </h2>
      <ClientReceiptView receiptId={id} billingSettings={billingSettings} graTin={graTin} />
    </div>
  );
}
