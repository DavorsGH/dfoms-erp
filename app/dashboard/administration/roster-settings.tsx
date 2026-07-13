"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import type { RosterConfigRecord } from "../operations/duty-roster-utils";
import type { ProjectEntry } from "./projects-utils";

type RosterSettingsProps = {
  initialConfig: RosterConfigRecord | null;
  initialProjects: ProjectEntry[];
  fetchError: string | null;
};

const emptyConfigForm = {
  cycle_start_date: "",
  cycle_length_days: "14",
  morning_time: "",
  afternoon_time: "",
  supervisor_time: "",
};

export default function RosterSettings({
  initialConfig,
  initialProjects,
  fetchError,
}: RosterSettingsProps) {
  const supabase = createClient();
  const [configForm, setConfigForm] = useState(
    initialConfig
      ? {
          cycle_start_date: initialConfig.cycle_start_date.slice(0, 10),
          cycle_length_days: String(initialConfig.cycle_length_days),
          morning_time: initialConfig.morning_time ?? "",
          afternoon_time: initialConfig.afternoon_time ?? "",
          supervisor_time: initialConfig.supervisor_time ?? "",
        }
      : emptyConfigForm,
  );
  const [projects, setProjects] = useState(initialProjects);
  const [requiredStaffDrafts, setRequiredStaffDrafts] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      initialProjects.map((project) => [
        project.project_code,
        project.required_staff == null ? "" : String(project.required_staff),
      ]),
    ),
  );
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingProjectCode, setLoadingProjectCode] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setProjects(initialProjects);
    setRequiredStaffDrafts(
      Object.fromEntries(
        initialProjects.map((project) => [
          project.project_code,
          project.required_staff == null ? "" : String(project.required_staff),
        ]),
      ),
    );
  }, [initialProjects]);

  useEffect(() => {
    if (initialConfig) {
      setConfigForm({
        cycle_start_date: initialConfig.cycle_start_date.slice(0, 10),
        cycle_length_days: String(initialConfig.cycle_length_days),
        morning_time: initialConfig.morning_time ?? "",
        afternoon_time: initialConfig.afternoon_time ?? "",
        supervisor_time: initialConfig.supervisor_time ?? "",
      });
    }
  }, [initialConfig]);

  async function refreshProjects() {
    const { data, error: refreshError } = await supabase
      .from("projects")
      .select("project_code, project_name, required_staff")
      .order("project_name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    const nextProjects = (data as ProjectEntry[] | null) ?? [];
    setProjects(nextProjects);
    setRequiredStaffDrafts(
      Object.fromEntries(
        nextProjects.map((project) => [
          project.project_code,
          project.required_staff == null ? "" : String(project.required_staff),
        ]),
      ),
    );
    setError(null);
  }

  async function handleConfigSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoadingConfig(true);
    setError(null);

    const payload = {
      cycle_start_date: configForm.cycle_start_date,
      cycle_length_days: Number.parseInt(configForm.cycle_length_days, 10) || 14,
      morning_time: configForm.morning_time.trim() || null,
      afternoon_time: configForm.afternoon_time.trim() || null,
      supervisor_time: configForm.supervisor_time.trim() || null,
    };

    const { error: saveError } = initialConfig
      ? await supabase
          .from("roster_config")
          .update(payload)
          .eq("id", initialConfig.id)
      : await supabase.from("roster_config").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoadingConfig(false);
      return;
    }

    setLoadingConfig(false);
  }

  async function saveRequiredStaff(projectCode: string) {
    setLoadingProjectCode(projectCode);
    setError(null);

    const rawValue = requiredStaffDrafts[projectCode]?.trim() ?? "";
    const requiredStaff =
      rawValue === "" ? null : Number.parseInt(rawValue, 10);

    if (rawValue !== "" && Number.isNaN(requiredStaff)) {
      setError("Required staff must be a whole number.");
      setLoadingProjectCode(null);
      return;
    }

    const { error: saveError } = await supabase
      .from("projects")
      .update({ required_staff: requiredStaff })
      .eq("project_code", projectCode);

    if (saveError) {
      setError(saveError.message);
      setLoadingProjectCode(null);
      return;
    }

    await refreshProjects();
    setLoadingProjectCode(null);
  }

  return (
    <div className="space-y-8">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
          Rotation & Shift Times
        </h3>
        <form onSubmit={handleConfigSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Cycle Start Date
              </label>
              <input
                type="date"
                required
                value={configForm.cycle_start_date}
                onChange={(event) =>
                  setConfigForm((current) => ({
                    ...current,
                    cycle_start_date: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Cycle Length (Days)
              </label>
              <input
                type="number"
                min={1}
                required
                value={configForm.cycle_length_days}
                onChange={(event) =>
                  setConfigForm((current) => ({
                    ...current,
                    cycle_length_days: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Morning Time
              </label>
              <input
                type="text"
                value={configForm.morning_time}
                onChange={(event) =>
                  setConfigForm((current) => ({
                    ...current,
                    morning_time: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Afternoon Time
              </label>
              <input
                type="text"
                value={configForm.afternoon_time}
                onChange={(event) =>
                  setConfigForm((current) => ({
                    ...current,
                    afternoon_time: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Supervisor Time
              </label>
              <input
                type="text"
                value={configForm.supervisor_time}
                onChange={(event) =>
                  setConfigForm((current) => ({
                    ...current,
                    supervisor_time: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loadingConfig}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingConfig ? "Saving…" : "Save Roster Settings"}
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Required Staff by Facility
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Set the target headcount for each contract/project site used on
            the Duty Roster.
          </p>
        </div>

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Project Code</th>
                <th className={scrollableTableThClassName}>Facility</th>
                <th className={scrollableTableThClassName}>Required Staff</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {projects.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No projects configured yet.
                  </td>
                </tr>
              ) : (
                projects.map((project) => (
                  <tr key={project.project_code}>
                    <td className="px-4 py-3">{project.project_code}</td>
                    <td className="px-4 py-3">{project.project_name}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        value={requiredStaffDrafts[project.project_code] ?? ""}
                        onChange={(event) =>
                          setRequiredStaffDrafts((current) => ({
                            ...current,
                            [project.project_code]: event.target.value,
                          }))
                        }
                        className={inputClassName}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => saveRequiredStaff(project.project_code)}
                        disabled={loadingProjectCode === project.project_code}
                        className="rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {loadingProjectCode === project.project_code
                          ? "Saving…"
                          : "Save"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>
    </div>
  );
}
