"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  getEmployeeDisplayName,
  type HrEmployee,
} from "../hr-payroll/employee-utils";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import type { ClientEntry } from "./clients-utils";
import {
  generateNextOperationsId,
  nullableInteger,
  nullableText,
  RISK_LEVEL_OPTIONS,
} from "./operations-register-utils";
import {
  getSiteBuildingZone,
  getSiteClientName,
  normalizeSiteEntry,
  SITE_SELECT,
  type SiteEntry,
} from "./sites-utils";

type SitesProps = {
  initialSites: SiteEntry[];
  initialClients: ClientEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
};

const emptyForm = {
  site_code: "",
  client_id: "",
  site_name: "",
  building: "",
  floor_zone: "",
  area_room: "",
  cleaning_frequency: "",
  risk_level: "",
  est_cleaning_time_min: "",
  assigned_supervisor: "",
  access_instructions: "",
  notes: "",
};

export default function Sites({
  initialSites,
  initialClients,
  initialEmployees,
  fetchError,
}: SitesProps) {
  const supabase = createClient();
  const [sites, setSites] = useState(initialSites.map(normalizeSiteEntry));
  const [showForm, setShowForm] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [filterClient, setFilterClient] = useState("");
  const [filterRiskLevel, setFilterRiskLevel] = useState("");

  useEffect(() => {
    setSites(initialSites.map(normalizeSiteEntry));
  }, [initialSites]);

  const filteredSites = useMemo(() => {
    return sites.filter((site) => {
      if (filterClient && (site.client_id ?? "") !== filterClient) {
        return false;
      }

      if (filterRiskLevel && (site.risk_level ?? "") !== filterRiskLevel) {
        return false;
      }

      return true;
    });
  }, [filterClient, filterRiskLevel, sites]);

  async function refreshSites() {
    const { data, error: refreshError } = await supabase
      .from("sites")
      .select(SITE_SELECT)
      .order("site_name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setSites(((data as SiteEntry[] | null) ?? []).map(normalizeSiteEntry));
    setError(null);
  }

  function openAddForm() {
    setEditingCode(null);
    setForm({
      ...emptyForm,
      site_code: generateNextOperationsId(
        "SITE",
        3,
        sites.map((site) => site.site_code),
      ),
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingCode(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(site: SiteEntry) {
    setEditingCode(site.site_code);
    setForm({
      site_code: site.site_code,
      client_id: site.client_id ?? "",
      site_name: site.site_name,
      building: site.building ?? "",
      floor_zone: site.floor_zone ?? "",
      area_room: site.area_room ?? "",
      cleaning_frequency: site.cleaning_frequency ?? "",
      risk_level: site.risk_level ?? "",
      est_cleaning_time_min:
        site.est_cleaning_time_min == null
          ? ""
          : String(site.est_cleaning_time_min),
      assigned_supervisor: site.assigned_supervisor ?? "",
      access_instructions: site.access_instructions ?? "",
      notes: site.notes ?? "",
    });
    setShowForm(true);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleDelete(siteCode: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingCode(siteCode);
    setError(null);

    const { error: deleteError } = await supabase
      .from("sites")
      .delete()
      .eq("site_code", siteCode);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingCode(null);
      return;
    }

    if (editingCode === siteCode) {
      closeForm();
    }

    await refreshSites();
    setDeletingCode(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      site_code: form.site_code.trim(),
      client_id: nullableText(form.client_id),
      site_name: form.site_name.trim(),
      building: nullableText(form.building),
      floor_zone: nullableText(form.floor_zone),
      area_room: nullableText(form.area_room),
      cleaning_frequency: nullableText(form.cleaning_frequency),
      risk_level: nullableText(form.risk_level),
      est_cleaning_time_min: nullableInteger(form.est_cleaning_time_min),
      assigned_supervisor: nullableText(form.assigned_supervisor),
      access_instructions: nullableText(form.access_instructions),
      notes: nullableText(form.notes),
    };

    const { error: saveError } = editingCode
      ? await supabase
          .from("sites")
          .update({
            client_id: payload.client_id,
            site_name: payload.site_name,
            building: payload.building,
            floor_zone: payload.floor_zone,
            area_room: payload.area_room,
            cleaning_frequency: payload.cleaning_frequency,
            risk_level: payload.risk_level,
            est_cleaning_time_min: payload.est_cleaning_time_min,
            assigned_supervisor: payload.assigned_supervisor,
            access_instructions: payload.access_instructions,
            notes: payload.notes,
          })
          .eq("site_code", editingCode)
      : await supabase.from("sites").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshSites();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-4">
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Client
            </label>
            <select
              value={filterClient}
              onChange={(event) => setFilterClient(event.target.value)}
              className={inputClassName}
            >
              <option value="">All clients</option>
              {initialClients.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.client_name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Risk Level
            </label>
            <select
              value={filterRiskLevel}
              onChange={(event) => setFilterRiskLevel(event.target.value)}
              className={inputClassName}
            >
              <option value="">All risk levels</option>
              {RISK_LEVEL_OPTIONS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Site"}
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {showForm ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingCode ? "Edit Site" : "New Site"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Site Code
                </label>
                <input
                  type="text"
                  required
                  readOnly
                  value={form.site_code}
                  className={`${inputClassName} bg-slate-50 text-slate-600`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Client
                </label>
                <select
                  value={form.client_id}
                  onChange={(event) => updateField("client_id", event.target.value)}
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
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Site Name
                </label>
                <input
                  type="text"
                  required
                  value={form.site_name}
                  onChange={(event) => updateField("site_name", event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Building
                </label>
                <input
                  type="text"
                  value={form.building}
                  onChange={(event) => updateField("building", event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Floor / Zone
                </label>
                <input
                  type="text"
                  value={form.floor_zone}
                  onChange={(event) => updateField("floor_zone", event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Area / Room
                </label>
                <input
                  type="text"
                  value={form.area_room}
                  onChange={(event) => updateField("area_room", event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Cleaning Frequency
                </label>
                <input
                  type="text"
                  value={form.cleaning_frequency}
                  onChange={(event) =>
                    updateField("cleaning_frequency", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Risk Level
                </label>
                <select
                  value={form.risk_level}
                  onChange={(event) => updateField("risk_level", event.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select risk level</option>
                  {RISK_LEVEL_OPTIONS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Est. Cleaning Time (min)
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.est_cleaning_time_min}
                  onChange={(event) =>
                    updateField("est_cleaning_time_min", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Assigned Supervisor
                </label>
                <select
                  value={form.assigned_supervisor}
                  onChange={(event) =>
                    updateField("assigned_supervisor", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select supervisor</option>
                  {initialEmployees.map((employee) => (
                    <option key={employee.employee_id} value={employee.employee_id}>
                      {employee.staff_id} — {employee.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Access Instructions
                </label>
                <textarea
                  value={form.access_instructions}
                  onChange={(event) =>
                    updateField("access_instructions", event.target.value)
                  }
                  rows={2}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                  rows={2}
                  className={inputClassName}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving…" : editingCode ? "Save Changes" : "Add Site"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={loading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Site Name</th>
              <th className={scrollableTableThClassName}>Client</th>
              <th className={scrollableTableThClassName}>Building/Zone</th>
              <th className={scrollableTableThClassName}>Cleaning Frequency</th>
              <th className={scrollableTableThClassName}>Risk Level</th>
              <th className={scrollableTableThClassName}>Assigned Supervisor</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredSites.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No sites match the selected filters.
                </td>
              </tr>
            ) : (
              filteredSites.map((site, index) => (
                <tr key={site.site_code} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    {site.site_name}
                  </td>
                  <td className="px-4 py-3">{getSiteClientName(site)}</td>
                  <td className="px-4 py-3">{getSiteBuildingZone(site)}</td>
                  <td className="px-4 py-3">{site.cleaning_frequency ?? "—"}</td>
                  <td className="px-4 py-3">{site.risk_level ?? "—"}</td>
                  <td className="px-4 py-3">
                    {site.assigned_supervisor
                      ? getEmployeeDisplayName(
                          initialEmployees,
                          site.assigned_supervisor,
                        )
                      : "—"}
                  </td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(site)}
                    onDelete={() => handleDelete(site.site_code)}
                    deleting={deletingCode === site.site_code}
                  />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
