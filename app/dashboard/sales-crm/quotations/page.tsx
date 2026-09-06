import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { fetchScopedEmployeeIds, applyEmployeeIdScope } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "@/app/dashboard/hr-payroll/employee-utils";
import {
  CLIENT_QUOTATION_LIST_SELECT,
  normalizeClientQuotationListRow,
  type ClientQuotationListRow,
} from "@/utils/client-quotations-types";
import { loadActiveServiceContractsByClientId } from "@/utils/service-contracts-api";
import CrmShell from "@/app/dashboard/crm/crm-shell";
import ClientQuotationsList from "./client-quotations-list";

export default async function ClientQuotationsPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <CrmShell sectionTitle="Quotations">
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </CrmShell>
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
  const { employeeIds, error: employeeScopeError } =
    await fetchScopedEmployeeIds(supabase, tenantId, buScope);

  const [{ data, error }, { data: employees, error: employeesError }, activeContractByClientId] =
    await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("client_quotations")
        .select(CLIENT_QUOTATION_LIST_SELECT)
        .eq("tenant_id", tenantId),
      buScope,
    )
      .order("issue_date", { ascending: false })
      .order("quotation_sequence", { ascending: false }),
    applyEmployeeIdScope(
      supabase.from("employees").select(HR_EMPLOYEE_SELECT),
      employeeIds,
    ).order("full_name"),
    loadActiveServiceContractsByClientId(supabase, tenantId),
  ]);

  return (
    <CrmShell sectionTitle="Quotations">
      <ClientQuotationsList
        initialQuotations={
          ((data as ClientQuotationListRow[] | null) ?? []).map(
            normalizeClientQuotationListRow,
          )
        }
        fetchError={
          error?.message ?? employeesError?.message ?? employeeScopeError ?? null
        }
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        activeContractByClientId={activeContractByClientId}
      />
    </CrmShell>
  );
}
