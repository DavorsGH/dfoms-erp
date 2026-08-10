import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  SALES_QUOTE_HEADER_SELECT,
  SALES_QUOTE_LINE_ITEM_SELECT,
  getClientName,
  normalizeSalesQuoteHeader,
  normalizeSalesQuoteLineItem,
  type SalesQuoteHeaderRow,
  type SalesQuoteLineItemRow,
} from "@/utils/sales-quotes-types";
import CrmShell from "../../crm-shell";
import QuoteView from "../quote-view";

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: quote, error: quoteError },
    { data: lineItems, error: lineItemsError },
    { data: clients, error: clientsError },
  ] = await Promise.all([
    supabase
      .from("sales_quotes")
      .select(SALES_QUOTE_HEADER_SELECT)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("sales_quote_line_items")
      .select(SALES_QUOTE_LINE_ITEM_SELECT)
      .eq("quote_id", id)
      .order("sort_order", { ascending: true }),
    supabase.from("customers").select("client_id, client_name"),
  ]);

  if (!quote) {
    notFound();
  }

  const fetchError =
    (quoteError as { message?: string } | null)?.message ??
    (lineItemsError as { message?: string } | null)?.message ??
    (clientsError as { message?: string } | null)?.message ??
    null;

  const normalizedQuote = normalizeSalesQuoteHeader(
    quote as SalesQuoteHeaderRow,
  );
  const normalizedLines = (
    (lineItems as SalesQuoteLineItemRow[] | null) ?? []
  ).map((row) => normalizeSalesQuoteLineItem(row));

  return (
    <CrmShell sectionTitle="Product Quotes">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-[#0f2744]">
          Quote {normalizedQuote.quote_number}
        </h3>
        <Link
          href="/dashboard/crm/quotes"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <QuoteView
        quote={normalizedQuote}
        lineItems={normalizedLines}
        clientName={getClientName(
          (clients as { client_id: string; client_name: string }[] | null) ??
            [],
          normalizedQuote.client_id,
        )}
        fetchError={fetchError}
      />
    </CrmShell>
  );
}
