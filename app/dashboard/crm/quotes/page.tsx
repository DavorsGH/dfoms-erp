import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  SALES_QUOTE_LIST_SELECT,
  normalizeSalesQuoteListRow,
  type SalesQuoteListRow,
} from "@/utils/sales-quotes-types";
import CrmShell from "../crm-shell";
import QuotesList from "./quotes-list";

export default async function QuotesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("sales_quotes")
    .select(SALES_QUOTE_LIST_SELECT)
    .order("quote_date", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <CrmShell sectionTitle="Product Quotes">
      <QuotesList
        initialQuotes={
          ((data as SalesQuoteListRow[] | null) ?? []).map(
            normalizeSalesQuoteListRow,
          )
        }
        fetchError={error?.message ?? null}
      />
    </CrmShell>
  );
}
