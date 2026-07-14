import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserEmployeeId } from "@/utils/dashboard-auth";
import MyLeave from "../my-leave";
import type {
  EmployeeLeaveBalance,
  LeaveRequest,
  LeaveType,
} from "../leave-request-utils";
import SelfServiceShell from "../self-service-shell";

export default async function SelfServiceLeavePage() {
  const employeeId = await getCurrentUserEmployeeId();
  const currentYear = new Date().getFullYear();

  if (!employeeId) {
    return (
      <SelfServiceShell sectionTitle="My Leave">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your user account is not linked to an employee record.
        </div>
      </SelfServiceShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: balances, error: balancesError },
    { data: requests, error: requestsError },
    { data: leaveTypes, error: typesError },
  ] = await Promise.all([
    supabase
      .from("employee_leave_balances")
      .select("*, leave_types(type_name)")
      .eq("year", currentYear)
      .order("leave_type_id"),
    supabase
      .from("leave_requests")
      .select("*, leave_types(type_name)")
      .order("submitted_at", { ascending: false }),
    supabase.from("leave_types").select("*").order("type_name"),
  ]);

  const fetchError =
    balancesError?.message ??
    requestsError?.message ??
    typesError?.message ??
    null;

  return (
    <SelfServiceShell sectionTitle="My Leave">
      <MyLeave
        initialBalances={(balances as EmployeeLeaveBalance[] | null) ?? []}
        initialRequests={(requests as LeaveRequest[] | null) ?? []}
        leaveTypes={(leaveTypes as LeaveType[] | null) ?? []}
        currentYear={currentYear}
        fetchError={fetchError}
      />
    </SelfServiceShell>
  );
}
