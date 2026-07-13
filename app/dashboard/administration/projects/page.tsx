import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import Projects from "../projects";
import type { ProjectEntry } from "../projects-utils";

export default async function ProjectsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("projects")
    .select("project_code, project_name")
    .order("project_name", { ascending: true });

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Contract/Project Assignments
      </h2>
      <Projects
        initialProjects={(data as ProjectEntry[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
