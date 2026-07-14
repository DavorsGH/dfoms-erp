import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { CLIENT_SELECT, type ClientEntry } from "../../operations/clients-utils";
import {
  ROSTER_CONFIG_SELECT,
  type RosterConfigRecord,
} from "../../operations/roster-config-utils";
import {
  SITE_SELECT,
  type SiteEntry,
} from "../../operations/sites-utils";
import RosterSettings from "../roster-settings";

export default async function RosterSettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: clients, error: clientsError },
    { data: configRows, error: configError },
    { data: sites, error: sitesError },
  ] = await Promise.all([
    supabase.from("clients").select(CLIENT_SELECT).order("client_name", {
      ascending: true,
    }),
    supabase.from("roster_config").select(ROSTER_CONFIG_SELECT),
    supabase
      .from("sites")
      .select(SITE_SELECT)
      .order("site_name", { ascending: true }),
  ]);

  const fetchError =
    clientsError?.message ?? configError?.message ?? sitesError?.message ?? null;

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Roster Settings</h2>
      <RosterSettings
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialConfigs={(configRows as RosterConfigRecord[] | null) ?? []}
        initialSites={(sites as SiteEntry[] | null) ?? []}
        fetchError={fetchError}
      />
    </>
  );
}
