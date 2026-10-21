"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardButton from "@/components/dashboard-button";
import TimePickerField from "@/components/time-picker-field";
import CentredMessageModal from "@/components/centred-message-modal";
import { useToast } from "@/components/feedback/feedback-context";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import CollapsibleDeviceSection from "./collapsible-device-section";
import { inputClassName } from "../employees/employee-record-utils";
import {
  DAVORS_OWN_STAFF_GROUP,
  DAVORS_OWN_STAFF_LABEL,
  employeeMatchesStaffGroup,
  projectsShareStaffGroup,
  type StaffGroupProject,
} from "@/lib/attendance-staff-groups";
import {
  OUTAGE_REASONS,
  hasRecentDeviceContact,
  todayInAccra,
} from "@/lib/attendance-requests/rules";

type GroupOption = {
  key: string;
  label: string;
  anchor_project_code: string;
  project_codes: string[];
  is_office: boolean;
};
type SiteOption = {
  site_code: string;
  site_name: string;
  project_code: string | null;
};
type EmployeeOption = {
  staff_id: string;
  full_name: string;
  contract_project: string | null;
};
type DeviceOption = {
  id: string;
  site_code: string | null;
  status: string;
  last_seen_at: string | null;
  contract_project: string | null;
  company_wide: boolean;
};

type Draft = { selected: boolean; clock_in: string; clock_out: string };

export default function OutageAttendancePanel({
  canWrite = true,
}: {
  canWrite?: boolean;
}) {
  const { toast } = useToast();
  const [projects, setProjects] = useState<StaffGroupProject[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [offlineMinutes, setOfflineMinutes] = useState(30);
  const [staffGroup, setStaffGroup] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [workDate, setWorkDate] = useState(todayInAccra());
  const [reason, setReason] = useState<(typeof OUTAGE_REASONS)[number]>(
    OUTAGE_REASONS[0],
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlineMessage, setOnlineMessage] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/attendance/outage");
      const body = (await response.json().catch(() => null)) as {
        projects?: StaffGroupProject[];
        groups?: GroupOption[];
        sites?: SiteOption[];
        employees?: EmployeeOption[];
        devices?: DeviceOption[];
        offline_alert_minutes?: number;
        error?: string;
      } | null;
      if (response.status === 403) {
        setForbidden(true);
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "Could not load outage attendance.");
        return;
      }
      setProjects(body?.projects ?? []);
      setGroups(body?.groups ?? []);
      setSites(body?.sites ?? []);
      setEmployees(body?.employees ?? []);
      setDevices(body?.devices ?? []);
      setOfflineMinutes(body?.offline_alert_minutes ?? 30);
    })();
  }, []);

  const selectedGroup = useMemo(() => {
    if (staffGroup === DAVORS_OWN_STAFF_GROUP) {
      return groups.find((group) => group.is_office) ?? null;
    }
    return groups.find((group) => group.key === staffGroup) ?? null;
  }, [groups, staffGroup]);
  const contractGroups = useMemo(
    () => groups.filter((group) => !group.is_office),
    [groups],
  );
  const locationSites = useMemo(
    () =>
      sites.filter(
        (site) =>
          site.project_code &&
          selectedGroup?.project_codes.includes(site.project_code),
      ),
    [selectedGroup, sites],
  );
  const groupEmployees = useMemo(
    () =>
      employees.filter((employee) =>
        employeeMatchesStaffGroup(
          employee.contract_project,
          staffGroup,
          projects,
        ),
      ),
    [employees, projects, staffGroup],
  );

  function deviceIsOnline(): boolean {
    const anchor = selectedGroup?.anchor_project_code ?? "";
    const groupDevices = devices.filter(
      (device) =>
        device.company_wide ||
        projectsShareStaffGroup(device.contract_project, anchor, projects),
    );
    const active = groupDevices.filter((device) => device.status !== "disabled");
    return active.some((device) =>
      hasRecentDeviceContact(device.last_seen_at, offlineMinutes),
    );
  }

  async function submit() {
    if (!canWrite) {
      setError("You have read-only access to attendance devices.");
      return;
    }
    setError(null);
    setSuccess(null);
    if (!staffGroup) {
      setError("Choose a staff group.");
      return;
    }
    if (deviceIsOnline()) {
      setOnlineMessage(
        "An attendance scanner for this staff group is online. Staff should use the scanner.",
      );
      return;
    }
    const entries = groupEmployees
      .filter((employee) => drafts[employee.staff_id]?.selected)
      .map((employee) => ({
        staff_id: employee.staff_id,
        clock_in: drafts[employee.staff_id]?.clock_in ?? "",
        clock_out: drafts[employee.staff_id]?.clock_out ?? "",
      }));
    if (entries.length === 0) {
      setError("Tick the employees who were present.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/attendance/outage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staff_group: staffGroup,
          site_code: siteCode || null,
          work_date: workDate,
          reason,
          entries,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
        created?: number;
        errors?: Array<{ staff_id: string; error: string }>;
      } | null;
      if (body?.code === "device_online") {
        setOnlineMessage(
          body.error ??
            "An attendance scanner for this staff group is online. Staff should use the scanner.",
        );
        return;
      }
      if (!response.ok && !body?.created) {
        setError(body?.error ?? "Could not submit outage attendance.");
        return;
      }
      const problem = body?.errors?.length
        ? body.errors.map((entry) => `${entry.staff_id}: ${entry.error}`).join(" ")
        : "";
      const submitted = `Submitted ${body?.created ?? 0} pending ${
        (body?.created ?? 0) === 1 ? "request" : "requests"
      }.${problem ? ` ${problem}` : ""}`;
      setSuccess(submitted);
      toast("Outage attendance submitted");
      setDrafts({});
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not submit outage attendance.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) {
    return null;
  }

  return (
    <CollapsibleDeviceSection
      storageKey="outage-attendance"
      title="Outage attendance"
      summary="Record attendance when a scanner is offline"
      defaultOpen={false}
    >
      <p className="mt-1 text-sm text-slate-600">
        Use this when a scanner for the staff group is offline, disabled, or not
        installed. Each ticked employee becomes a pending request. Nothing is
        written to the attendance register until it is approved.
      </p>
      {error ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Staff group</span>
          <select
            className={inputClassName}
            value={staffGroup}
            onChange={(event) => {
              setStaffGroup(event.target.value);
              setSiteCode("");
              setDrafts({});
            }}
          >
            <option value="">Select staff group</option>
            {contractGroups.map((group) => (
              <option key={group.key} value={group.key}>
                {group.label}
              </option>
            ))}
            <option value={DAVORS_OWN_STAFF_GROUP}>{DAVORS_OWN_STAFF_LABEL}</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            Location (optional)
          </span>
          <select
            className={inputClassName}
            value={siteCode}
            onChange={(event) => setSiteCode(event.target.value)}
            disabled={!staffGroup}
          >
            <option value="">No location</option>
            {locationSites.map((site) => (
              <option key={site.site_code} value={site.site_code}>
                {site.site_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Date</span>
          <input
            type="date"
            className={inputClassName}
            max={todayInAccra()}
            value={workDate}
            onChange={(event) => setWorkDate(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Reason</span>
          <select
            className={inputClassName}
            value={reason}
            onChange={(event) =>
              setReason(event.target.value as (typeof OUTAGE_REASONS)[number])
            }
          >
            {OUTAGE_REASONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {staffGroup ? (
        <div className="mt-4 overflow-x-auto">
          {groupEmployees.length === 0 ? (
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    <th className={scrollableTableThClassName}>Employee</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-4 py-6 text-center text-sm text-slate-500">
                      No active employees are in this staff group.
                    </td>
                  </tr>
                </tbody>
              </table>
            </ScrollableTable>
          ) : (
            <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Present</th>
                  <th className={scrollableTableThClassName}>Employee</th>
                  <th className={scrollableTableThClassName}>Clock in</th>
                  <th className={scrollableTableThClassName}>Clock out</th>
                </tr>
              </thead>
              <tbody>
                {groupEmployees.map((employee) => {
                  const draft = drafts[employee.staff_id] ?? {
                    selected: false,
                    clock_in: "08:00",
                    clock_out: "17:00",
                  };
                  return (
                    <tr key={employee.staff_id} className="border-t border-slate-100">
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={draft.selected}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [employee.staff_id]: {
                                ...draft,
                                selected: event.target.checked,
                              },
                            }))
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        {employee.staff_id} — {employee.full_name}
                      </td>
                      <td className="px-2 py-2">
                        <TimePickerField
                          aria-label={`${employee.full_name} clock in`}
                          value={draft.clock_in}
                          onChange={(value) =>
                            setDrafts((current) => ({
                              ...current,
                              [employee.staff_id]: {
                                ...draft,
                                clock_in: value,
                              },
                            }))
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <TimePickerField
                          aria-label={`${employee.full_name} clock out`}
                          value={draft.clock_out}
                          onChange={(value) =>
                            setDrafts((current) => ({
                              ...current,
                              [employee.staff_id]: {
                                ...draft,
                                clock_out: value,
                              },
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </ScrollableTable>
          )}
        </div>
      ) : null}

      {canWrite ? (
      <DashboardButton
        type="button"
        className="mt-4"
        disabled={busy}
        onClick={() => void submit()}
      >
        Submit outage attendance
      </DashboardButton>
      ) : null}

      {onlineMessage ? (
        <CentredMessageModal
          title="Scanner is online"
          message={onlineMessage}
          onClose={() => setOnlineMessage(null)}
        />
      ) : null}
    </CollapsibleDeviceSection>
  );
}
