import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import FinanceNav from "../finance-nav";
import StaffWelfareFund from "../staff-welfare-fund";
import {
  STAFF_WELFARE_LEDGER_SELECT,
  normalizeStaffWelfareFundEntry,
  type StaffWelfareFundLedgerEntry,
} from "../staff-welfare-fund-utils";
import {
  filterActiveEmployees,
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";

export default async function StaffWelfareFundPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
        <FinanceNav />
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Staff Welfare Fund
        </h2>
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </div>
    );
  }

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

  const [{ data: entriesData, error: entriesError }, { data: employeesData, error: employeesError }] =
    await Promise.all([
      applyBusinessUnitScope(
        supabase
          .from("staff_welfare_fund_ledger")
          .select(STAFF_WELFARE_LEDGER_SELECT)
          .eq("tenant_id", tenantId)
          .neq("status", "reversed")
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false }),
        buScope,
      ),
      applyBusinessUnitScope(
        supabase
          .from("employees")
          .select(HR_EMPLOYEE_SELECT)
          .eq("tenant_id", tenantId)
          .order("full_name", { ascending: true }),
        buScope,
      ),
    ]);

  const initialEntries = ((entriesData as StaffWelfareFundLedgerEntry[] | null) ?? []).map(
    normalizeStaffWelfareFundEntry,
  );
  const initialEmployees = filterActiveEmployees(
    (employeesData as HrEmployee[] | null) ?? [],
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-2 text-xl font-semibold text-[#0f2744]">Staff Welfare Fund</h2>
      <p className="mb-6 text-sm text-slate-600">
        Track welfare deductions accrued from payroll and record fund disbursements.
        Balance Sheet shows the open liability as Staff Welfare Payable.
      </p>
      <StaffWelfareFund
        tenantId={tenantId}
        initialEntries={initialEntries}
        initialEmployees={initialEmployees}
        fetchError={entriesError?.message ?? employeesError?.message ?? null}
        activeBusinessUnitId={activeBusinessUnitId}
      />
    </div>
  );
}
