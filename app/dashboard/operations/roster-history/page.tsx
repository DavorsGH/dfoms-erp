import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import OperationsShell from "../operations-shell";
import RosterHistory from "../roster-history";
import type { RosterHistoryRecord } from "../duty-roster-utils";
import { fetchRosterHistoryEmployeeDisplayScoped } from "@/utils/duty-roster-employees";

export default async function RosterHistoryPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [{ data: history, error: historyError }, employeesResult] =
    await Promise.all([
      supabase
        .from("roster_history")
        .select("*")
        .order("effective_date", { ascending: false })
        .order("roster_number", { ascending: false }),
      fetchRosterHistoryEmployeeDisplayScoped(supabase, buScope),
    ]);

  const fetchError =
    historyError?.message ?? employeesResult.error ?? null;

  return (
    <OperationsShell sectionTitle="Roster History">
      <RosterHistory
        initialHistory={(history as RosterHistoryRecord[] | null) ?? []}
        employees={employeesResult.employees}
        fetchError={fetchError}
      />
    </OperationsShell>
  );
}
