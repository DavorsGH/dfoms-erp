import { cookies } from "next/headers";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { CLIENT_SELECT, type ClientEntry } from "@/app/dashboard/operations/clients-utils";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { getNextInvoiceSequence, loadAuthorizedSignerOptions } from "@/utils/client-invoices-api";
import {
  defaultDueDate,
  todayIsoDate,
  type ClientInvoiceSiteOption,
} from "@/utils/client-invoices-types";
import { PAYMENT_ACCOUNT_SELECT } from "@/utils/payment-accounts-types";
import FinanceNav from "../../finance-nav";
import ClientInvoiceForm from "../client-invoice-form";

export default async function NewClientInvoicePage() {
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

  const [
    { data: customers, error: customersError },
    { data: sites, error: sitesError },
    { data: paymentAccounts, error: paymentAccountsError },
    nextSequenceResult,
    authorizedSignersResult,
  ] = await Promise.all([
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", { ascending: true }),
    supabase
      .from("sites")
      .select("site_code, site_name, client_id")
      .order("site_name", { ascending: true }),
    supabase
      .from("payment_accounts")
      .select(PAYMENT_ACCOUNT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("account_name", { ascending: true }),
    getNextInvoiceSequence(supabase, tenantId),
    loadAuthorizedSignerOptions(supabase, tenantId),
  ]);

  const fetchError =
    customersError?.message ??
    sitesError?.message ??
    paymentAccountsError?.message ??
    nextSequenceResult.error ??
    authorizedSignersResult.error ??
    null;

  const nextSequence = nextSequenceResult.sequence;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-[#0f2744]">New Client Invoice</h2>
        <Link
          href="/dashboard/finance/client-invoices"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <ClientInvoiceForm
        mode="create"
        nextInvoiceSequence={nextSequence}
        initialCustomers={(customers as ClientEntry[] | null) ?? []}
        initialSites={(sites as ClientInvoiceSiteOption[] | null) ?? []}
        initialPaymentAccounts={paymentAccounts ?? []}
        initialAuthorizedSigners={authorizedSignersResult.signers}
        initialForm={{
          client_id: "",
          invoice_date: todayIsoDate(),
          due_date: defaultDueDate(),
          billing_period_start: "",
          billing_period_end: "",
          bill_to_name: "",
          bill_to_address: "",
          bill_to_phone: "",
          vat_nhil_getfund_rate: 20,
          wht_rate: 7.5,
          status: "draft",
          amount_received: 0,
          notes: "",
          authorized_by_selection: "",
          authorized_by_other_name: "",
          authorized_by_other_title: "",
          payment_account_ids: [],
          line_items: [],
        }}
        fetchError={fetchError}
      />
    </div>
  );
}
