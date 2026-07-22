import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { Employee } from "../../../lookup-types";
import BalanceSheetShell from "../../balance-sheet-shell";
import CapitalContributions from "../../capital-contributions";
import type { CapitalContributionEntry } from "../../capital-contributions-utils";

export default async function CapitalContributionsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("capital_contributions")
        .select("*, employees!capital_contributions_contributed_by_fkey(full_name)")
        .order("date", { ascending: false }),
      supabase
        .from("employees")
        .select("employee_id, full_name")
        .order("full_name", { ascending: true }),
    ]);

  let entries = (data as CapitalContributionEntry[] | null) ?? [];
  let fetchError = error?.message ?? employeesError?.message ?? null;

  if (error?.message) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from("capital_contributions")
      .select("*")
      .order("date", { ascending: false });

    entries = (fallbackData as CapitalContributionEntry[] | null) ?? [];
    fetchError = fallbackError?.message ?? employeesError?.message ?? null;
  }

  return (
    <BalanceSheetShell sectionTitle="Capital Contributions">
      <CapitalContributions
        initialEntries={entries}
        initialEmployees={(employees as Employee[] | null) ?? []}
        fetchError={fetchError}
      />
    </BalanceSheetShell>
  );
}
