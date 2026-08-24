import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { CLIENT_SELECT, type ClientEntry } from "../../operations/clients-utils";
import {
  SITE_ASSIGNMENT_SELECT,
  type SiteEntry,
} from "../../operations/sites-utils";
import Projects from "../projects";
import {
  normalizeProjectEntry,
  PROJECT_SELECT,
  type ProjectEntry,
} from "../projects-utils";

export default async function ProjectsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  const projectsQuery = supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .order("project_name", { ascending: true });
  const sitesQuery = supabase
    .from("sites")
    .select(SITE_ASSIGNMENT_SELECT)
    .order("site_name", { ascending: true });
  const clientsQuery = supabase
    .from("customers")
    .select(CLIENT_SELECT)
    .order("client_name", { ascending: true });
  const employeesQuery = supabase
    .from("employees")
    .select("contract_project")
    .not("contract_project", "is", null);

  if (tenantId) {
    projectsQuery.eq("tenant_id", tenantId);
    sitesQuery.eq("tenant_id", tenantId);
    clientsQuery.eq("tenant_id", tenantId);
    employeesQuery.eq("tenant_id", tenantId);
  }

  const [
    { data, error },
    { data: sites, error: sitesError },
    { data: clients, error: clientsError },
    { data: employees, error: employeesError },
  ] = await Promise.all([
    projectsQuery,
    sitesQuery,
    clientsQuery,
    employeesQuery,
  ]);

  const employeeCountByProjectCode: Record<string, number> = {};
  for (const row of employees ?? []) {
    const code = row.contract_project as string | null;
    if (!code) continue;
    employeeCountByProjectCode[code] =
      (employeeCountByProjectCode[code] ?? 0) + 1;
  }

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Contract/Project Assignments
      </h2>
      <Projects
        initialProjects={
          (data as ProjectEntry[] | null)?.map((project) =>
            normalizeProjectEntry(project),
          ) ?? []
        }
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialEmployeeCountByProjectCode={employeeCountByProjectCode}
        fetchError={
          error?.message ??
          sitesError?.message ??
          clientsError?.message ??
          employeesError?.message ??
          null
        }
      />
    </>
  );
}
