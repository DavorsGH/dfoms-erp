import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import FinanceNav from "../finance-nav";
import ManualFinancialEntries from "../manual-financial-entries";
import type { ManualFinancialEntryRecord } from "../manual-financial-entries-utils";

export default async function ManualFinancialEntriesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("manual_financial_entries")
    .select("*")
    .order("period_month", { ascending: false });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Manual Financial Entries
      </h2>
      <ManualFinancialEntries
        initialEntries={(data as ManualFinancialEntryRecord[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </div>
  );
}
