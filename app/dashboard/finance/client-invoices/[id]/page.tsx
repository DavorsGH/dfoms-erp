import FinanceNav from "../../finance-nav";
import ClientInvoiceView from "../client-invoice-view";
import { getCurrentTenantBillingSettingsHeader } from "@/utils/billing-settings-load";

type ViewClientInvoicePageProps = {
  params: Promise<{ id: string }>;
};

export default async function ViewClientInvoicePage({
  params,
}: ViewClientInvoicePageProps) {
  const { id } = await params;
  const billingSettings = await getCurrentTenantBillingSettingsHeader();

  return (
    <div>
      <h1 className="no-print mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <div className="no-print">
        <FinanceNav />
      </div>
      <h2 className="no-print mb-6 text-xl font-semibold text-[#0f2744]">
        Client Invoice
      </h2>
      <ClientInvoiceView invoiceId={id} billingSettings={billingSettings} />
    </div>
  );
}
