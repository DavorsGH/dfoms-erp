import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { CLIENT_SELECT, type ClientEntry } from "@/app/dashboard/operations/clients-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "@/app/dashboard/inventory/finished-products-utils";
import {
  SALES_QUOTE_HEADER_SELECT,
  SALES_QUOTE_LINE_ITEM_SELECT,
  quoteHeaderToFormState,
  type SalesQuoteHeaderRow,
  type SalesQuoteLineItemRow,
  type SalesQuoteSiteOption,
} from "@/utils/sales-quotes-types";
import CrmShell from "../../../crm-shell";
import QuoteForm from "../../quote-form";

type EditQuotePageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditQuotePage({ params }: EditQuotePageProps) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: quote, error: quoteError },
    { data: lineItems, error: lineItemsError },
    { data: customers, error: customersError },
    { data: sites, error: sitesError },
    { data: products, error: productsError },
    { data: opportunities, error: opportunitiesError },
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
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", {
      ascending: true,
    }),
    supabase
      .from("sites")
      .select("site_code, site_name, client_id")
      .order("site_name", { ascending: true }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .order("product_name", { ascending: true }),
    supabase
      .from("sales_opportunities")
      .select("id, opportunity_name, client_id")
      .order("opportunity_name", { ascending: true }),
  ]);

  if (!quote) {
    notFound();
  }

  const normalizedQuote = quote as SalesQuoteHeaderRow;
  if (normalizedQuote.status !== "draft") {
    redirect(`/dashboard/crm/quotes/${id}`);
  }

  const fetchError =
    (quoteError as { message?: string } | null)?.message ??
    (lineItemsError as { message?: string } | null)?.message ??
    (customersError as { message?: string } | null)?.message ??
    (sitesError as { message?: string } | null)?.message ??
    (productsError as { message?: string } | null)?.message ??
    (opportunitiesError as { message?: string } | null)?.message ??
    null;

  return (
    <CrmShell sectionTitle="Product Quotes">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-[#0f2744]">
          Edit Quote {normalizedQuote.quote_number}
        </h3>
        <Link
          href={`/dashboard/crm/quotes/${id}`}
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to quote
        </Link>
      </div>
      <QuoteForm
        mode="edit"
        quoteId={id}
        initialCustomers={(customers as ClientEntry[] | null) ?? []}
        initialSites={(sites as SalesQuoteSiteOption[] | null) ?? []}
        initialProducts={
          ((products as FinishedProductRecord[] | null) ?? []).map((row) =>
            normalizeFinishedProduct(row),
          )
        }
        initialOpportunities={
          (opportunities as
            | { id: string; opportunity_name: string; client_id: string }[]
            | null) ?? []
        }
        initialForm={quoteHeaderToFormState(
          normalizedQuote,
          ((lineItems as SalesQuoteLineItemRow[] | null) ?? []).map((row) => ({
            ...row,
            labour_amount: Number(row.labour_amount) || 0,
            material_amount: Number(row.material_amount) || 0,
            discount_amount: Number(row.discount_amount) || 0,
            total_cost: Number(row.total_cost) || 0,
          })),
        )}
        fetchError={fetchError}
      />
    </CrmShell>
  );
}
