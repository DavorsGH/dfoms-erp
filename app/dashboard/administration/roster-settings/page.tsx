import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import RosterSettings from "../roster-settings";
import type { RosterConfigRecord } from "../../operations/duty-roster-utils";
import type { ProjectEntry } from "../projects-utils";

export default async function RosterSettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data: configRows, error: configError }, { data: projects, error: projectsError }] =
    await Promise.all([
      supabase.from("roster_config").select("*").limit(1),
      supabase
        .from("projects")
        .select("project_code, project_name, required_staff")
        .order("project_name", { ascending: true }),
    ]);

  const fetchError = configError?.message ?? projectsError?.message ?? null;

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Roster Settings</h2>
      <RosterSettings
        initialConfig={(configRows?.[0] as RosterConfigRecord | undefined) ?? null}
        initialProjects={(projects as ProjectEntry[] | null) ?? []}
        fetchError={fetchError}
      />
    </>
  );
}
