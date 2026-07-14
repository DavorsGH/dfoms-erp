"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { ClientEntry } from "../operations/clients-utils";
import { inputClassName } from "../employees/employee-record-utils";
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
  getProjectClientName,
  getProjectSiteCount,
  normalizeProjectEntry,
  PROJECT_SELECT,
  type ProjectEntry,
} from "./projects-utils";
import {
  getSiteBuildingZone,
  getSiteClientName,
  normalizeSiteEntry,
  SITE_ASSIGNMENT_SELECT,
  type SiteEntry,
} from "../operations/sites-utils";

type ProjectsProps = {
  initialProjects: ProjectEntry[];
  initialSites: SiteEntry[];
  initialClients: ClientEntry[];
  fetchError: string | null;
};

const emptyContractForm = {
  project_code: "",
  project_name: "",
};

export default function Projects({
  initialProjects,
  initialSites,
  initialClients,
  fetchError,
}: ProjectsProps) {
  const supabase = createClient();
  const [projects, setProjects] = useState(initialProjects);
  const [sites, setSites] = useState(initialSites.map(normalizeSiteEntry));
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [showContractForm, setShowContractForm] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [contractForm, setContractForm] = useState(emptyContractForm);
  const [editingSiteCode, setEditingSiteCode] = useState<string | null>(null);
  const [siteStaffValue, setSiteStaffValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  useEffect(() => {
    setSites(initialSites.map(normalizeSiteEntry));
  }, [initialSites]);

  const contractProjects = useMemo(
    () =>
      [...projects].sort((left, right) =>
        left.project_name.localeCompare(right.project_name),
      ),
    [projects],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const assignedSites = useMemo(() => {
    if (!selectedProjectId) {
      return [];
    }

    return sites
      .filter((site) => site.project_id === selectedProjectId)
      .sort((left, right) => left.site_name.localeCompare(right.site_name));
  }, [selectedProjectId, sites]);

  async function refreshData() {
    const [{ data: projectRows, error: projectError }, { data: siteRows, error: siteError }] =
      await Promise.all([
        supabase
          .from("projects")
          .select(PROJECT_SELECT)
          .order("project_name", { ascending: true }),
        supabase
          .from("sites")
          .select(SITE_ASSIGNMENT_SELECT)
          .order("site_name", { ascending: true }),
      ]);

    if (projectError || siteError) {
      setError(projectError?.message ?? siteError?.message ?? "Refresh failed.");
      return;
    }

    setProjects(
      ((projectRows as unknown as ProjectEntry[] | null) ?? []).map((project) =>
        normalizeProjectEntry(project),
      ),
    );
    setSites(
      ((siteRows as unknown as SiteEntry[] | null) ?? []).map((site) =>
        normalizeSiteEntry(site),
      ),
    );
    setError(null);
  }

  function openAddContractForm() {
    setEditingCode(null);
    setContractForm(emptyContractForm);
    setShowContractForm(true);
  }

  function closeContractForm() {
    setEditingCode(null);
    setContractForm(emptyContractForm);
    setShowContractForm(false);
  }

  function openEditContractForm(project: ProjectEntry) {
    setEditingCode(project.project_code);
    setContractForm({
      project_code: project.project_code,
      project_name: project.project_name,
    });
    setShowContractForm(true);
  }

  async function handleDeleteContract(projectCode: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingCode(projectCode);
    setError(null);

    const { error: deleteError } = await supabase
      .from("projects")
      .delete()
      .eq("project_code", projectCode);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingCode(null);
      return;
    }

    if (selectedProject?.project_code === projectCode) {
      setSelectedProjectId("");
    }

    if (editingCode === projectCode) {
      closeContractForm();
    }

    await refreshData();
    setDeletingCode(null);
  }

  async function handleContractSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      project_code: contractForm.project_code.trim(),
      project_name: contractForm.project_name.trim(),
    };

    const { error: saveError } = editingCode
      ? await supabase
          .from("projects")
          .update({ project_name: payload.project_name })
          .eq("project_code", editingCode)
      : await supabase.from("projects").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeContractForm();
    await refreshData();
    setLoading(false);
  }

  function openEditSiteStaff(site: SiteEntry) {
    setEditingSiteCode(site.site_code);
    setSiteStaffValue(
      site.required_staff == null ? "" : String(site.required_staff),
    );
  }

  function closeEditSiteStaff() {
    setEditingSiteCode(null);
    setSiteStaffValue("");
  }

  async function handleSaveSiteStaff(siteCode: string) {
    setLoading(true);
    setError(null);

    const trimmed = siteStaffValue.trim();
    const requiredStaff =
      trimmed === "" ? null : Number.parseInt(trimmed, 10);

    if (trimmed !== "" && Number.isNaN(requiredStaff)) {
      setError("Required staff must be a whole number.");
      setLoading(false);
      return;
    }

    const { error: saveError } = await supabase
      .from("sites")
      .update({ required_staff: requiredStaff })
      .eq("site_code", siteCode);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeEditSiteStaff();
    await refreshData();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            Manage contract projects and assign operational sites to each
            contract.
          </p>
          <button
            type="button"
            onClick={() => (showContractForm ? closeContractForm() : openAddContractForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showContractForm ? "Cancel" : "Add Contract"}
          </button>
        </div>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {showContractForm ? (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
              {editingCode ? "Edit Contract" : "New Contract"}
            </h3>
            <form onSubmit={handleContractSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Project Code
                  </label>
                  <input
                    type="text"
                    required
                    readOnly={Boolean(editingCode)}
                    value={contractForm.project_code}
                    onChange={(event) =>
                      setContractForm((current) => ({
                        ...current,
                        project_code: event.target.value,
                      }))
                    }
                    className={`${inputClassName}${editingCode ? " bg-slate-50 text-slate-600" : ""}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Contract / Project Name
                  </label>
                  <input
                    type="text"
                    required
                    value={contractForm.project_name}
                    onChange={(event) =>
                      setContractForm((current) => ({
                        ...current,
                        project_name: event.target.value,
                      }))
                    }
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
                  {loading ? "Saving…" : editingCode ? "Save Changes" : "Add Contract"}
                </button>
                <button
                  type="button"
                  onClick={closeContractForm}
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
                <th className={scrollableTableThClassName}>Project Code</th>
                <th className={scrollableTableThClassName}>Contract Name</th>
                <th className={scrollableTableThClassName}>Client</th>
                <th className={scrollableTableThClassName}>Sites</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {contractProjects.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No contract projects configured yet.
                  </td>
                </tr>
              ) : (
                contractProjects.map((project, index) => (
                  <tr
                    key={project.id}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3">{project.project_code}</td>
                    <td className="px-4 py-3">{project.project_name}</td>
                    <td className="px-4 py-3">
                      {getProjectClientName(project, sites)}
                    </td>
                    <td className="px-4 py-3">{getProjectSiteCount(project)}</td>
                    <RegisterRowActions
                      onEdit={() => openEditContractForm(project)}
                      onDelete={() => handleDeleteContract(project.project_code)}
                      deleting={deletingCode === project.project_code}
                    />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[280px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Site Assignment — Select Contract / Project
            </label>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className={inputClassName}
            >
              <option value="">Select contract</option>
              {contractProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.project_code} — {project.project_name}
                </option>
              ))}
            </select>
          </div>
          {selectedProject ? (
            <p className="text-sm text-slate-600">
              {assignedSites.length} site(s) linked to{" "}
              <span className="font-medium text-[#0f2744]">
                {selectedProject.project_name}
              </span>
            </p>
          ) : null}
        </div>

        {!selectedProjectId ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Select a contract to view and manage its assigned sites.
          </p>
        ) : (
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Site Name</th>
                  <th className={scrollableTableThClassName}>Client</th>
                  <th className={scrollableTableThClassName}>Building/Zone</th>
                  <th className={scrollableTableThClassName}>Required Staff</th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {assignedSites.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      No sites are linked to this contract yet.
                    </td>
                  </tr>
                ) : (
                  assignedSites.map((site, index) => (
                    <tr
                      key={site.site_code}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3 font-medium text-[#0f2744]">
                        {site.site_name}
                      </td>
                      <td className="px-4 py-3">{getSiteClientName(site)}</td>
                      <td className="px-4 py-3">{getSiteBuildingZone(site)}</td>
                      <td className="px-4 py-3">
                        {editingSiteCode === site.site_code ? (
                          <input
                            type="number"
                            min={0}
                            value={siteStaffValue}
                            onChange={(event) =>
                              setSiteStaffValue(event.target.value)
                            }
                            className={inputClassName}
                          />
                        ) : (
                          (site.required_staff ?? "—")
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingSiteCode === site.site_code ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => handleSaveSiteStaff(site.site_code)}
                              className="rounded-md bg-[#0f2744] px-3 py-1.5 text-xs font-medium text-white"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              disabled={loading}
                              onClick={closeEditSiteStaff}
                              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openEditSiteStaff(site)}
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Edit Staff
                          </button>
                        )}
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
