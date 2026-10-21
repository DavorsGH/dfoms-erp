import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import type { ShiftTimeRecord } from "@/lib/shift-attendance";
import type { TenantHoliday } from "../public-holidays-card";
import {
  ROSTER_CONFIG_SELECT,
  type RosterConfigRecord,
} from "../../operations/roster-config-utils";
import type { RosterContractProject } from "@/lib/roster-contract-choices";
import {
  SITE_SELECT,
  type SiteEntry,
} from "../../operations/sites-utils";
import RosterSettings from "../roster-settings";

export default async function RosterSettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const tenantId = await getCurrentUserTenantId();
  const [
    { data: projects, error: projectsError },
    { data: configRows, error: configError },
    { data: sites, error: sitesError },
    { data: graceRow, error: graceError },
    { data: shiftRows, error: shiftError },
    { data: holidayRows, error: holidayError },
  ] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "project_code, project_name, service_contract_id, contract_type, is_archived",
      )
      .order("project_name", { ascending: true }),
    supabase.from("roster_config").select(ROSTER_CONFIG_SELECT),
    supabase
      .from("sites")
      .select(SITE_SELECT)
      .order("site_name", { ascending: true }),
    supabase
      .from("attendance_grace_policy")
      .select("late_grace_minutes, early_leave_grace_minutes")
      .maybeSingle(),
    supabase
      .from("contract_shift_times")
      .select(
        "client_id, shift, day_type, start_time, end_time, late_grace_minutes, early_leave_grace_minutes",
      ),
    supabase
      .from("tenant_holidays")
      .select("id, holiday_date, name")
      .order("holiday_date", { ascending: true }),
  ]);

  const fetchError =
    projectsError?.message ??
    configError?.message ??
    sitesError?.message ??
    null;

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Roster & Shift Settings</h2>
      <RosterSettings
        initialProjects={(projects as RosterContractProject[] | null) ?? []}
        initialConfigs={(configRows as RosterConfigRecord[] | null) ?? []}
        initialSites={(sites as SiteEntry[] | null) ?? []}
        fetchError={fetchError}
        tenantId={tenantId}
        initialGrace={graceRow}
        initialShiftTimes={(shiftRows as ShiftTimeRecord[] | null) ?? []}
        shiftLoadError={graceError?.message ?? shiftError?.message ?? null}
        initialHolidays={(holidayRows as TenantHoliday[] | null) ?? []}
        holidayLoadError={holidayError?.message ?? null}
      />
    </>
  );
}
