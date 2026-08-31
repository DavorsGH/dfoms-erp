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
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
import type { PipelineClient } from "./sales-pipeline-utils";
import CrmShell from "../crm-shell";
import SalesPipeline from "./sales-pipeline";
import {
  PIPELINE_CLIENT_SELECT,
  SALES_ACTIVITY_SELECT,
  SALES_OPPORTUNITY_SELECT,
  normalizeSalesActivity,
  normalizeSalesOpportunity,
  type SalesActivity,
  type SalesOpportunity,
} from "./sales-pipeline-utils";

export default async function SalesPipelinePage() {
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

  const [
    { data: opportunities, error: opportunitiesError },
    { data: activities, error: activitiesError },
    { data: clients, error: clientsError },
    { data: employees, error: employeesError },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("sales_opportunities")
        .select(SALES_OPPORTUNITY_SELECT),
      buScope,
    ).order("updated_at", { ascending: false }),
    supabase
      .from("sales_activities")
      .select(SALES_ACTIVITY_SELECT)
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("customers")
      .select(PIPELINE_CLIENT_SELECT)
      .order("client_name", { ascending: true }),
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
  ]);

  const fetchError =
    opportunitiesError?.message ??
    activitiesError?.message ??
    clientsError?.message ??
    employeesError?.message ??
    null;

  return (
    <CrmShell sectionTitle="Sales Pipeline">
      <SalesPipeline
        initialOpportunities={
          ((opportunities as SalesOpportunity[] | null) ?? []).map((row) =>
            normalizeSalesOpportunity(row),
          )
        }
        initialActivities={
          ((activities as SalesActivity[] | null) ?? []).map((row) =>
            normalizeSalesActivity(row),
          )
        }
        initialClients={(clients as PipelineClient[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
        activeBusinessUnitId={activeBusinessUnitId}
      />
    </CrmShell>
  );
}
