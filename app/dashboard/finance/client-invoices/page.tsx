import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  CLIENT_INVOICE_LIST_SELECT,
  normalizeClientInvoiceListRow,
  type ClientInvoiceListRow,
} from "@/utils/client-invoices-types";
import FinanceNav from "../finance-nav";
import ClientInvoicesList from "./client-invoices-list";

export default async function ClientInvoicesPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
        <FinanceNav />
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </div>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("client_invoices")
    .select(CLIENT_INVOICE_LIST_SELECT)
    .eq("tenant_id", tenantId)
    .order("invoice_date", { ascending: false })
    .order("invoice_sequence", { ascending: false });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Client Invoices</h2>
      <ClientInvoicesList
        initialInvoices={
          ((data as ClientInvoiceListRow[] | null) ?? []).map(
            normalizeClientInvoiceListRow,
          )
        }
        fetchError={error?.message ?? null}
      />
    </div>
  );
}
