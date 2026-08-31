import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  COMMISSION_RULE_LIST_SELECT,
  normalizeCommissionRuleRow,
  type CommissionRuleListRow,
} from "@/utils/commission-types";
import {
  filterActiveEmployees,
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
import CrmShell from "../crm-shell";
import CommissionRulesList from "./commission-rules-list";

export default async function CommissionRulesPage() {
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

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      applyBusinessUnitScope(
        supabase
          .from("commission_rules")
          .select(COMMISSION_RULE_LIST_SELECT),
        buScope,
      ).order("effective_start", { ascending: false }),
      supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    ]);

  return (
    <CrmShell sectionTitle="Commission Rules">
      <CommissionRulesList
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        initialRules={
          ((data as CommissionRuleListRow[] | null) ?? []).map(normalizeCommissionRuleRow)
        }
        fetchError={error?.message ?? employeesError?.message ?? null}
      />
    </CrmShell>
  );
}
