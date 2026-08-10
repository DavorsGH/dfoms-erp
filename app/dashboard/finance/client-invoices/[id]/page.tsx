import FinanceNav from "../../finance-nav";
import ClientInvoiceView from "../client-invoice-view";
import { getCurrentTenantBillingSettingsHeader } from "@/utils/billing-settings-load";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";

type ViewClientInvoicePageProps = {
  params: Promise<{ id: string }>;
};

export default async function ViewClientInvoicePage({
  params,
}: ViewClientInvoicePageProps) {
  const { id } = await params;
  const billingSettings = await getCurrentTenantBillingSettingsHeader();
  const tenantId = await getCurrentUserTenantId();

  let paymentMethods: string[] = [];
  if (tenantId) {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data } = await supabase
      .from("payment_methods")
      .select("name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });
    paymentMethods = data?.map((row) => row.name).filter(Boolean) ?? [];
  }

  return (
    <div>
      <h1 className="no-print mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <div className="no-print">
        <FinanceNav />
      </div>
      <h2 className="no-print mb-6 text-xl font-semibold text-[#0f2744]">
        Customer Invoice
      </h2>
      <ClientInvoiceView
        invoiceId={id}
        billingSettings={billingSettings}
        paymentMethods={paymentMethods}
      />
    </div>
  );
}
