import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getCurrentUserEmployeeId,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import { ROUTE_HANDLER_AUTH_OPTS } from "@/lib/middleware-trust-policy";
import MyLeave from "../my-leave";
import type {
  EmployeeLeaveBalance,
  LeaveRequest,
  LeaveType,
} from "../leave-request-utils";
import SelfServiceShell from "../self-service-shell";

export default async function SelfServiceLeavePage() {
  const employeeId = await getCurrentUserEmployeeId();
  const tenantId = await getCurrentUserTenantId(ROUTE_HANDLER_AUTH_OPTS);
  const currentYear = new Date().getFullYear();

  if (!employeeId) {
    return (
      <SelfServiceShell sectionTitle="My Leave">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your user account is not linked to an employee record. Contact HR or
          your administrator to request leave.
        </div>
      </SelfServiceShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error: ensureBalancesError } = await supabase.rpc(
    "ensure_my_leave_balances_for_year",
    { p_year: currentYear },
  );
  if (ensureBalancesError) {
    console.warn(
      "[self-service/leave] ensure_my_leave_balances_for_year:",
      ensureBalancesError.message,
    );
  }

  const [
    { data: balances, error: balancesError },
    { data: requests, error: requestsError },
    { data: leaveTypes, error: typesError },
  ] = await Promise.all([
    supabase
      .from("employee_leave_balances")
      .select("*, leave_types(type_name)")
      .eq("employee_id", employeeId)
      .eq("year", currentYear)
      .order("leave_type_id"),
    supabase
      .from("leave_requests")
      .select("*, leave_types(type_name)")
      .eq("employee_id", employeeId)
      .order("submitted_at", { ascending: false }),
    tenantId
      ? supabase
          .from("leave_types")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("type_name")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const fetchError =
    balancesError?.message ??
    requestsError?.message ??
    typesError?.message ??
    null;

  return (
    <SelfServiceShell sectionTitle="My Leave">
      <MyLeave
        employeeId={employeeId}
        initialBalances={(balances as EmployeeLeaveBalance[] | null) ?? []}
        initialRequests={(requests as LeaveRequest[] | null) ?? []}
        leaveTypes={(leaveTypes as LeaveType[] | null) ?? []}
        currentYear={currentYear}
        fetchError={fetchError}
      />
    </SelfServiceShell>
  );
}
