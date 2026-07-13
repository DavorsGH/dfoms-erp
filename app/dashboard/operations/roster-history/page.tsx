import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import OperationsShell from "../operations-shell";
import RosterHistory from "../roster-history";
import type { RosterHistoryRecord } from "../duty-roster-utils";

export default async function RosterHistoryPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data: history, error: historyError }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("roster_history")
        .select("*")
        .order("effective_date", { ascending: false })
        .order("roster_number", { ascending: false }),
      supabase
        .from("employees")
        .select("employee_id, staff_id, full_name")
        .order("staff_id", { ascending: true }),
    ]);

  const fetchError = historyError?.message ?? employeesError?.message ?? null;

  return (
    <OperationsShell sectionTitle="Roster History">
      <RosterHistory
        initialHistory={(history as RosterHistoryRecord[] | null) ?? []}
        employees={employees ?? []}
        fetchError={fetchError}
      />
    </OperationsShell>
  );
}
