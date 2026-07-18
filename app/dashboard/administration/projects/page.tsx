import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
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

  const [
    { data, error },
    { data: sites, error: sitesError },
    { data: clients, error: clientsError },
  ] = await Promise.all([
    supabase
      .from("projects")
      .select(PROJECT_SELECT)
      .order("project_name", { ascending: true }),
    supabase
      .from("sites")
      .select(SITE_ASSIGNMENT_SELECT)
      .order("site_name", { ascending: true }),
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", {
      ascending: true,
    }),
  ]);

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
        fetchError={
          error?.message ?? sitesError?.message ?? clientsError?.message ?? null
        }
      />
    </>
  );
}
