"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useToast, useAlert } from "@/components/feedback/feedback-context";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  sitesForContract,
  siteProjectCode,
} from "@/lib/operations-contract-scope";
import {
  listRosterContractChoices,
  type RosterContractProject,
} from "@/lib/roster-contract-choices";
import { useRosterContractSelection } from "../operations/use-roster-contract-selection";
import {
  getRosterConfigForClient,
  type RosterConfigRecord,
} from "../operations/roster-config-utils";
import {
  normalizeSiteEntry,
  SITE_SELECT,
  type SiteEntry,
} from "../operations/sites-utils";
import {
  useStampBusinessUnitId,
} from "@/app/dashboard/business-unit-view-context";
import ShiftTimesCard from "./shift-times-card";
import type { TenantHoliday } from "./public-holidays-card";
import type { ShiftTimeRecord } from "@/lib/shift-attendance";
import {
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  loadWriteBusinessUnitContext,
  resolveWriteBusinessUnitIdForCreate,
} from "@/utils/business-unit-access";

type RosterSettingsProps = {
  initialProjects: RosterContractProject[];
  initialConfigs: RosterConfigRecord[];
  initialSites: SiteEntry[];
  fetchError: string | null;
  tenantId: string | null;
  initialGrace: { late_grace_minutes: number; early_leave_grace_minutes: number } | null;
  initialShiftTimes: ShiftTimeRecord[];
  shiftLoadError: string | null;
  initialHolidays: TenantHoliday[];
  holidayLoadError: string | null;
};

const emptyConfigForm = {
  cycle_start_date: "",
  cycle_length_days: "14",
  morning_time: "",
  afternoon_time: "",
  supervisor_time: "",
};

export default function RosterSettings({
  initialProjects,
  initialConfigs,
  initialSites,
  fetchError,
  tenantId,
  initialGrace,
  initialShiftTimes,
  shiftLoadError,
  initialHolidays,
  holidayLoadError,
}: RosterSettingsProps) {
  const supabase = createClient();
  const { toast } = useToast();
  const { alertError } = useAlert();
  const stampBusinessUnit = useStampBusinessUnitId();
  const contractChoices = listRosterContractChoices({
    projects: initialProjects,
    sites: initialSites.map((site) => ({
      client_id: site.client_id,
      project_code: siteProjectCode(site),
    })),
    employees: [],
  });
  const {
    groupKey: selectedContractKey,
    selected: selectedContract,
    selectContract,
  } = useRosterContractSelection(contractChoices);
  const selectedClientId = selectedContract?.clientId ?? "";
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

  useEffect(() => {
    if (fetchError) {
      void alertError(fetchError);
    }
  }, [alertError, fetchError]);

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

  const clientSites = selectedContractKey
    ? sitesForContract(sites, selectedContractKey, initialProjects).sort(
        (left, right) => left.site_name.localeCompare(right.site_name),
      )
    : [];

  async function refreshSites() {
    const { data, error: refreshError } = await supabase
      .from("sites")
      .select(SITE_SELECT)
      .order("site_name", { ascending: true });

    if (refreshError) {
      await alertError(refreshError);
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
  }

  async function handleConfigSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedClientId) {
      const contractSelect = event.currentTarget.querySelector("#roster-contract");
      if (contractSelect instanceof HTMLSelectElement) {
        contractSelect.setCustomValidity(
          selectedContract?.dataIssue ??
            "Select a contract before saving roster & shift settings.",
        );
        contractSelect.reportValidity();
      }
      return;
    }

    const startInput = document.getElementById("roster-cycle-start");
    const lengthInput = document.getElementById("roster-cycle-length");
    if (startInput instanceof HTMLInputElement) {
      startInput.setCustomValidity("");
    }
    if (lengthInput instanceof HTMLInputElement) {
      lengthInput.setCustomValidity("");
    }
    const cycleLength = Number.parseInt(configForm.cycle_length_days, 10);
    if (!configForm.cycle_start_date) {
      if (startInput instanceof HTMLInputElement) {
        startInput.setCustomValidity("Enter a cycle start date to save a rotation.");
        startInput.reportValidity();
      }
      return;
    }
    if (!Number.isInteger(cycleLength) || cycleLength < 1) {
      if (lengthInput instanceof HTMLInputElement) {
        lengthInput.setCustomValidity(
          "Enter a cycle length of at least 1 day to save a rotation.",
        );
        lengthInput.reportValidity();
      }
      return;
    }

    setLoadingConfig(true);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setLoadingConfig(false);
      await alertError(buContext.error);
      return;
    }

    let createBusinessUnitId: string | null = null;
    if (selectedConfig) {
      try {
        assertCanModifyBusinessUnitRow(
          buContext.allowedUnits,
          selectedConfig.business_unit_id,
        );
      } catch (accessError) {
        setLoadingConfig(false);
        await alertError(formatBusinessUnitAccessError(accessError));
        return;
      }
    } else {
      const stampResult = resolveWriteBusinessUnitIdForCreate({
        allowedUnits: buContext.allowedUnits,
        stamp: stampBusinessUnit,
      });
      if (!stampResult.ok) {
        setLoadingConfig(false);
        await alertError(stampResult.error);
        return;
      }
      createBusinessUnitId = stampResult.businessUnitId;
    }

    const payload = {
      client_id: selectedClientId,
      cycle_start_date: configForm.cycle_start_date,
      cycle_length_days: cycleLength,
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
      : await supabase.from("roster_config").insert({
          ...payload,
          business_unit_id: createBusinessUnitId,
        });

    if (saveError) {
      setLoadingConfig(false);
      await alertError(saveError);
      return;
    }

    setLoadingConfig(false);
    toast("Roster & shift settings saved");
  }

  async function saveRequiredStaff(siteCode: string) {
    setLoadingSiteCode(siteCode);

    const rawValue = requiredStaffDrafts[siteCode]?.trim() ?? "";
    const requiredStaff =
      rawValue === "" ? null : Number.parseInt(rawValue, 10);
    const staffInput = document.getElementById(
      `roster-required-staff-${siteCode}`,
    );

    if (rawValue !== "" && Number.isNaN(requiredStaff)) {
      setLoadingSiteCode(null);
      if (staffInput instanceof HTMLInputElement) {
        staffInput.setCustomValidity("Required staff must be a whole number.");
        staffInput.reportValidity();
      }
      return;
    }
    if (staffInput instanceof HTMLInputElement) {
      staffInput.setCustomValidity("");
    }

    const { error: saveError } = await supabase
      .from("sites")
      .update({ required_staff: requiredStaff })
      .eq("site_code", siteCode);

    if (saveError) {
      setLoadingSiteCode(null);
      await alertError(saveError);
      return;
    }

    await refreshSites();
    setLoadingSiteCode(null);
    toast("Required staff saved");
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-1 text-lg font-semibold text-[#0f2744]">Rotation</h3>
        <p className="mb-4 text-sm text-slate-600">
          Cycle start and length are only needed when you save a rotation.
          Shift times, public holidays, and attendance grace save on their own
          and do not create a cycle.
        </p>
        <div className="mb-4 max-w-md">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Contract
          </label>
          <select
            id="roster-contract"
            value={selectedContractKey}
            onChange={(event) => {
              event.currentTarget.setCustomValidity("");
              selectContract(event.target.value);
            }}
            className={inputClassName}
          >
            <option value="">Select contract</option>
            {contractChoices.map((choice) => (
              <option key={choice.groupKey} value={choice.groupKey}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>

        {selectedContract?.dataIssue ? (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {selectedContract.dataIssue}
          </p>
        ) : null}

        {!selectedClientId ? (
          <p className="text-sm text-slate-600">
            Select a contract to save its shift times. Public holidays and
            attendance grace apply to the whole company. A rotation cycle is
            optional.
          </p>
        ) : (
          <form onSubmit={handleConfigSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Cycle Start Date
                </label>
                <input
                  id="roster-cycle-start"
                  type="date"
                  value={configForm.cycle_start_date}
                  onChange={(event) => {
                    event.currentTarget.setCustomValidity("");
                    setConfigForm((current) => ({
                      ...current,
                      cycle_start_date: event.target.value,
                    }));
                  }}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Cycle Length (Days)
                </label>
                <input
                  id="roster-cycle-length"
                  type="number"
                  min={1}
                  value={configForm.cycle_length_days}
                  onChange={(event) => {
                    event.currentTarget.setCustomValidity("");
                    setConfigForm((current) => ({
                      ...current,
                      cycle_length_days: event.target.value,
                    }));
                  }}
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
                  ? "Save Roster & Shift Settings"
                  : "Create Roster & Shift Settings"}
            </button>
          </form>
        )}
      </section>

      <ShiftTimesCard
        tenantId={tenantId}
        clientId={selectedClientId}
        initialGrace={initialGrace}
        initialShiftTimes={initialShiftTimes}
        loadError={shiftLoadError}
        previousTimes={{
          morning: configForm.morning_time,
          afternoon: configForm.afternoon_time,
          supervisor: configForm.supervisor_time,
        }}
        initialHolidays={initialHolidays}
        holidayLoadError={holidayLoadError}
      />

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Required Staff by Facility
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Set the target headcount for each site used on the Duty Roster for
            the selected contract.
          </p>
        </div>

        {!selectedClientId ? (
          <p className="text-sm text-slate-600">
            Select a contract above to manage required staff for its facilities.
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
                      No linked sites found for this customer.
                    </td>
                  </tr>
                ) : (
                  clientSites.map((site) => (
                    <tr key={site.site_code}>
                      <td className="px-4 py-3">{site.site_code}</td>
                      <td className="px-4 py-3">{site.site_name}</td>
                      <td className="px-4 py-3">
                        <input
                          id={`roster-required-staff-${site.site_code}`}
                          type="number"
                          min={0}
                          value={requiredStaffDrafts[site.site_code] ?? ""}
                          onChange={(event) => {
                            event.currentTarget.setCustomValidity("");
                            setRequiredStaffDrafts((current) => ({
                              ...current,
                              [site.site_code]: event.target.value,
                            }));
                          }}
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
