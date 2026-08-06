import { cookies } from "next/headers";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { CLIENT_SELECT, type ClientEntry } from "@/app/dashboard/operations/clients-utils";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { loadAuthorizedSignerOptions, peekNextInvoiceNumber } from "@/utils/client-invoices-api";
import {
  defaultDueDate,
  todayIsoDate,
  type ClientInvoiceSiteOption,
} from "@/utils/client-invoices-types";
import {
  SALES_QUOTE_HEADER_SELECT,
  SALES_QUOTE_LINE_ITEM_SELECT,
  quoteLineItemsToInvoiceFormLines,
  type SalesQuoteHeaderRow,
  type SalesQuoteLineItemRow,
} from "@/utils/sales-quotes-types";
import { PAYMENT_ACCOUNT_SELECT } from "@/utils/payment-accounts-types";
import FinanceNav from "../../finance-nav";
import ClientInvoiceForm from "../client-invoice-form";

type NewClientInvoicePageProps = {
  searchParams: Promise<{ quoteId?: string | string[] }>;
};

export default async function NewClientInvoicePage({
  searchParams,
}: NewClientInvoicePageProps) {
  const params = await searchParams;
  const quoteIdParam = params.quoteId;
  const quoteId =
    typeof quoteIdParam === "string"
      ? quoteIdParam.trim()
      : Array.isArray(quoteIdParam)
        ? quoteIdParam[0]?.trim() ?? ""
        : "";

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

  const quoteFetchPromise = quoteId
    ? Promise.all([
        supabase
          .from("sales_quotes")
          .select(SALES_QUOTE_HEADER_SELECT)
          .eq("id", quoteId)
          .maybeSingle(),
        supabase
          .from("sales_quote_line_items")
          .select(SALES_QUOTE_LINE_ITEM_SELECT)
          .eq("quote_id", quoteId)
          .order("sort_order", { ascending: true }),
      ])
    : Promise.resolve([{ data: null, error: null }, { data: null, error: null }] as const);

  const [
    { data: customers, error: customersError },
    { data: sites, error: sitesError },
    { data: paymentAccounts, error: paymentAccountsError },
    nextInvoiceNumberResult,
    authorizedSignersResult,
    quoteResults,
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
    peekNextInvoiceNumber(supabase, tenantId),
    loadAuthorizedSignerOptions(supabase, tenantId),
    quoteFetchPromise,
  ]);

  const [{ data: quoteRow, error: quoteError }, { data: quoteLines, error: quoteLinesError }] =
    quoteResults;

  const quote =
    quoteRow &&
    (quoteRow as SalesQuoteHeaderRow).quote_type === "service" &&
    (quoteRow as SalesQuoteHeaderRow).status === "accepted"
      ? (quoteRow as SalesQuoteHeaderRow)
      : null;

  const quotePrefillLines = quote
    ? quoteLineItemsToInvoiceFormLines(
        ((quoteLines as SalesQuoteLineItemRow[] | null) ?? []).map((line) => ({
          ...line,
          labour_amount: Number(line.labour_amount) || 0,
          material_amount: Number(line.material_amount) || 0,
          discount_amount: Number(line.discount_amount) || 0,
          total_cost: Number(line.total_cost) || 0,
        })),
      )
    : [];

  const fetchError =
    customersError?.message ??
    sitesError?.message ??
    paymentAccountsError?.message ??
    nextInvoiceNumberResult.error ??
    authorizedSignersResult.error ??
    (quoteId && !quote ? quoteError?.message ?? "Quote not found or not eligible for invoice conversion." : null) ??
    quoteLinesError?.message ??
    null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-[#0f2744]">
          {quote ? `New Invoice from Quote ${quote.quote_number}` : "New Customer Invoice"}
        </h2>
        <Link
          href="/dashboard/finance/client-invoices"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <ClientInvoiceForm
        mode="create"
        quoteConversionId={quote ? quote.id : undefined}
        nextInvoiceNumberPreview={nextInvoiceNumberResult.invoiceNumber}
        initialCustomers={(customers as ClientEntry[] | null) ?? []}
        initialSites={(sites as ClientInvoiceSiteOption[] | null) ?? []}
        initialPaymentAccounts={paymentAccounts ?? []}
        initialAuthorizedSigners={authorizedSignersResult.signers}
        initialForm={{
          client_id: quote?.client_id ?? "",
          invoice_date: todayIsoDate(),
          due_date: defaultDueDate(),
          billing_period_start: "",
          billing_period_end: "",
          bill_to_name: quote?.bill_to_name ?? "",
          bill_to_address: quote?.bill_to_address ?? "",
          bill_to_phone: "",
          vat_nhil_getfund_rate: 20,
          wht_rate: 7.5,
          status: "draft",
          amount_received: 0,
          notes: quote?.notes ?? "",
          authorized_by_selection: "",
          authorized_by_other_name: "",
          authorized_by_other_title: "",
          payment_account_ids: [],
          line_items: quotePrefillLines,
        }}
        fetchError={fetchError}
      />
    </div>
  );
}
