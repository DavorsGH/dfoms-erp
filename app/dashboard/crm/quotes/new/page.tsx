import { cookies } from "next/headers";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { CLIENT_SELECT, type ClientEntry } from "@/app/dashboard/operations/clients-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "@/app/dashboard/inventory/finished-products-utils";
import {
  emptyQuoteForm,
  type SalesQuoteSiteOption,
} from "@/utils/sales-quotes-types";
import CrmShell from "../../crm-shell";
import QuoteForm from "../quote-form";

export default async function NewQuotePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: customers, error: customersError },
    { data: sites, error: sitesError },
    { data: products, error: productsError },
    { data: opportunities, error: opportunitiesError },
  ] = await Promise.all([
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

  const fetchError =
    customersError?.message ??
    sitesError?.message ??
    productsError?.message ??
    opportunitiesError?.message ??
    null;

  return (
    <CrmShell sectionTitle="Product Quotes">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-[#0f2744]">New Product Quote</h3>
        <Link
          href="/dashboard/crm/quotes"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <QuoteForm
        mode="create"
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
        initialForm={emptyQuoteForm()}
        fetchError={fetchError}
      />
    </CrmShell>
  );
}
