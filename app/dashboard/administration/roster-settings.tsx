"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import type { ClientEntry } from "../operations/clients-utils";
import { filterSitesForClient } from "../operations/duty-roster-utils";
import {
  getRosterConfigForClient,
  type RosterConfigRecord,
} from "../operations/roster-config-utils";
import {
  normalizeSiteEntry,
  SITE_SELECT,
  type SiteEntry,
} from "../operations/sites-utils";

type RosterSettingsProps = {
  initialClients: ClientEntry[];
  initialConfigs: RosterConfigRecord[];
  initialSites: SiteEntry[];
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
  initialClients,
  initialConfigs,
  initialSites,
  fetchError,
}: RosterSettingsProps) {
  const supabase = createClient();
  const [selectedClientId, setSelectedClientId] = useState("");
  const selectedConfig = getRosterConfigForClient(initialConfigs, selectedClientId);
  const [configForm, setConfigForm] = useState(emptyConfigForm);
  const [sites, setSites] = useState(initialSites.map(normalizeSiteEntry));
  const [requiredStaffDrafts, setRequiredStaffDrafts] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      initialSites.map((site) => [
        site.site_code,
        site.required_staff == null ? "" : String(site.required_staff),
      ]),
    ),
  );
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingSiteCode, setLoadingSiteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setSites(initialSites.map(normalizeSiteEntry));
    setRequiredStaffDrafts(
      Object.fromEntries(
        initialSites.map((site) => [
          site.site_code,
          site.required_staff == null ? "" : String(site.required_staff),
        ]),
      ),
    );
  }, [initialSites]);

  useEffect(() => {
    if (selectedConfig) {
      setConfigForm({
        cycle_start_date: selectedConfig.cycle_start_date.slice(0, 10),
        cycle_length_days: String(selectedConfig.cycle_length_days),
        morning_time: selectedConfig.morning_time ?? "",
        afternoon_time: selectedConfig.afternoon_time ?? "",
        supervisor_time: selectedConfig.supervisor_time ?? "",
      });
      return;
    }

    setConfigForm(emptyConfigForm);
  }, [selectedConfig]);

  const clientSites = selectedClientId
    ? filterSitesForClient(sites, selectedClientId).sort((left, right) =>
        left.site_name.localeCompare(right.site_name),
      )
    : [];

  async function refreshSites() {
    const { data, error: refreshError } = await supabase
      .from("sites")
      .select(SITE_SELECT)
      .order("site_name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    const nextSites =
      ((data as unknown as SiteEntry[] | null) ?? []).map((site) =>
        normalizeSiteEntry(site),
      );
    setSites(nextSites);
    setRequiredStaffDrafts(
      Object.fromEntries(
        nextSites.map((site) => [
          site.site_code,
          site.required_staff == null ? "" : String(site.required_staff),
        ]),
      ),
    );
    setError(null);
  }

  async function handleConfigSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedClientId) {
      setError("Select a client before saving roster settings.");
      return;
    }

    setLoadingConfig(true);
    setError(null);

    const payload = {
      client_id: selectedClientId,
      cycle_start_date: configForm.cycle_start_date,
      cycle_length_days: Number.parseInt(configForm.cycle_length_days, 10) || 14,
      morning_time: configForm.morning_time.trim() || null,
      afternoon_time: configForm.afternoon_time.trim() || null,
      supervisor_time: configForm.supervisor_time.trim() || null,
    };

    const { error: saveError } = selectedConfig
      ? await supabase
          .from("roster_config")
          .update({
            cycle_start_date: payload.cycle_start_date,
            cycle_length_days: payload.cycle_length_days,
            morning_time: payload.morning_time,
            afternoon_time: payload.afternoon_time,
            supervisor_time: payload.supervisor_time,
          })
          .eq("id", selectedConfig.id)
      : await supabase.from("roster_config").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoadingConfig(false);
      return;
    }

    setLoadingConfig(false);
  }

  async function saveRequiredStaff(siteCode: string) {
    setLoadingSiteCode(siteCode);
    setError(null);

    const rawValue = requiredStaffDrafts[siteCode]?.trim() ?? "";
    const requiredStaff =
      rawValue === "" ? null : Number.parseInt(rawValue, 10);

    if (rawValue !== "" && Number.isNaN(requiredStaff)) {
      setError("Required staff must be a whole number.");
      setLoadingSiteCode(null);
      return;
    }

    const { error: saveError } = await supabase
      .from("sites")
      .update({ required_staff: requiredStaff })
      .eq("site_code", siteCode);

    if (saveError) {
      setError(saveError.message);
      setLoadingSiteCode(null);
      return;
    }

    await refreshSites();
    setLoadingSiteCode(null);
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
        <div className="mb-4 max-w-md">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Client
          </label>
          <select
            value={selectedClientId}
            onChange={(event) => setSelectedClientId(event.target.value)}
            className={inputClassName}
          >
            <option value="">Select client</option>
            {initialClients.map((client) => (
              <option key={client.client_id} value={client.client_id}>
                {client.client_name}
              </option>
            ))}
          </select>
        </div>

        {!selectedClientId ? (
          <p className="text-sm text-slate-600">
            Select a client to configure their rotation cycle and shift times.
            New clients do not receive default roster settings automatically.
          </p>
        ) : (
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
              {loadingConfig
                ? "Saving…"
                : selectedConfig
                  ? "Save Roster Settings"
                  : "Create Roster Settings"}
            </button>
          </form>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Required Staff by Facility
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Set the target headcount for each site used on the Duty Roster for
            the selected client.
          </p>
        </div>

        {!selectedClientId ? (
          <p className="text-sm text-slate-600">
            Select a client above to manage required staff for their facilities.
          </p>
        ) : (
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Site Code</th>
                  <th className={scrollableTableThClassName}>Facility</th>
                  <th className={scrollableTableThClassName}>Required Staff</th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {clientSites.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      No linked sites found for this client.
                    </td>
                  </tr>
                ) : (
                  clientSites.map((site) => (
                    <tr key={site.site_code}>
                      <td className="px-4 py-3">{site.site_code}</td>
                      <td className="px-4 py-3">{site.site_name}</td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min={0}
                          value={requiredStaffDrafts[site.site_code] ?? ""}
                          onChange={(event) =>
                            setRequiredStaffDrafts((current) => ({
                              ...current,
                              [site.site_code]: event.target.value,
                            }))
                          }
                          className={inputClassName}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => saveRequiredStaff(site.site_code)}
                          disabled={loadingSiteCode === site.site_code}
                          className="rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {loadingSiteCode === site.site_code
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
        )}
      </section>
    </div>
  );
}
