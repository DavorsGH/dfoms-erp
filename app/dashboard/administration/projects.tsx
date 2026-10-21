"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAlert, useToast } from "@/components/feedback";
import { createClient } from "@/utils/supabase/client";
import type { ServiceContractListRow } from "@/utils/service-contracts-types";
import {
  formatProjectDeleteBlockedByEmployeesMessage,
  getProjectDeleteErrorMessage,
} from "@/utils/project-delete-errors";
import type { ClientEntry } from "../operations/clients-utils";
import { inputClassName } from "../employees/employee-record-utils";
import RegisterRowActions, {
  confirmArchiveEntry,
  confirmDeleteEntry,
  confirmReactivateEntry,
  getStripedRowClassName,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  duplicateContractNameMessage,
  findActiveContractNameDuplicate,
  formatProjectClientContractLabel,
  formatServiceContractOptionLabel,
  getProjectClientName,
  getProjectSiteCount,
  normalizeProjectEntry,
  PROJECT_SELECT,
  shouldShowServiceContractInProjectForm,
  type ProjectEntry,
} from "./projects-utils";
import {
  getSiteBuildingZone,
  getSiteClientName,
  normalizeSiteEntry,
  SITE_ASSIGNMENT_SELECT,
  type SiteEntry,
} from "../operations/sites-utils";
import {
  useStampBusinessUnitId,
  useBusinessUnitReadScope,
} from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import {
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  loadWriteBusinessUnitContext,
  resolveWriteBusinessUnitIdForCreate,
} from "@/utils/business-unit-access";
import {
  assertTenantIdForMutation,
  tenantScopedDelete,
  tenantScopedUpdate,
} from "@/utils/tenant-scoped-supabase";
import { allocateProjectCode } from "./project-code-api";
import { formatCountNoun } from "@/utils/pluralise";

type ProjectsProps = {
  tenantId: string;
  initialProjects: ProjectEntry[];
  initialSites: SiteEntry[];
  initialClients: ClientEntry[];
  initialServiceContracts: ServiceContractListRow[];
  /** employee count keyed by project_code */
  initialEmployeeCountByProjectCode?: Record<string, number>;
  fetchError: string | null;
};

const emptyContractForm = {
  project_code: "",
  project_name: "",
  service_contract_id: "",
  contract_type: "contract" as "contract" | "adhoc",
};

export default function Projects({
  tenantId,
  initialProjects,
  initialSites,
  initialClients,
  initialServiceContracts,
  initialEmployeeCountByProjectCode = {},
  fetchError,
}: ProjectsProps) {
  const supabase = createClient();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const scopedTenantId = assertTenantIdForMutation(tenantId);
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
  const [projects, setProjects] = useState(
    initialProjects.map(normalizeProjectEntry),
  );
  const [sites, setSites] = useState(initialSites.map(normalizeSiteEntry));
  const [employeeCountByProjectCode, setEmployeeCountByProjectCode] = useState(
    initialEmployeeCountByProjectCode,
  );
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [showContractForm, setShowContractForm] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"" | "contract" | "adhoc">("");
  const [typeSort, setTypeSort] = useState<"asc" | "desc" | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [archivingCode, setArchivingCode] = useState<string | null>(null);
  const [reactivatingCode, setReactivatingCode] = useState<string | null>(null);
  const [contractForm, setContractForm] = useState(emptyContractForm);
  const [editingSiteCode, setEditingSiteCode] = useState<string | null>(null);
  const [siteStaffValue, setSiteStaffValue] = useState("");
  const [loading, setLoading] = useState(false);
  const contractSaveLock = useRef(false);
  const contractNameRef = useRef<HTMLInputElement>(null);
  const [serviceContracts] = useState(initialServiceContracts);

  useEffect(() => {
    if (fetchError) {
      void alertError(fetchError);
    }
  }, [alertError, fetchError]);

  useEffect(() => {
    setProjects(initialProjects.map(normalizeProjectEntry));
  }, [initialProjects]);

  const serviceContractsById = useMemo(
    () => new Map(serviceContracts.map((contract) => [contract.id, contract])),
    [serviceContracts],
  );

  const formLinkedServiceContractId = useMemo(() => {
    const trimmed = contractForm.service_contract_id.trim();
    return trimmed ? trimmed : null;
  }, [contractForm.service_contract_id]);

  const serviceContractFormOptions = useMemo(
    () =>
      [...serviceContracts]
        .filter((contract) =>
          shouldShowServiceContractInProjectForm(
            contract,
            formLinkedServiceContractId,
          ),
        )
        .sort((left, right) =>
          left.contract_number.localeCompare(right.contract_number),
        ),
    [formLinkedServiceContractId, serviceContracts],
  );

  useEffect(() => {
    setSites(initialSites.map(normalizeSiteEntry));
  }, [initialSites]);

  useEffect(() => {
    setEmployeeCountByProjectCode(initialEmployeeCountByProjectCode);
  }, [initialEmployeeCountByProjectCode]);

  const contractProjects = useMemo(() => {
    const filtered = projects.filter((project) =>
      typeFilter ? (project.contract_type ?? "contract") === typeFilter : true,
    );
    return [...filtered].sort((left, right) => {
      if (typeSort) {
        const typeCompare = (left.contract_type ?? "contract").localeCompare(
          right.contract_type ?? "contract",
        );
        if (typeCompare !== 0) {
          return typeSort === "asc" ? typeCompare : -typeCompare;
        }
      }
      return left.project_name.localeCompare(right.project_name);
    });
  }, [projects, typeFilter, typeSort]);

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

  async function refreshEmployeeCounts(projectCodes: string[]) {
    if (projectCodes.length === 0) {
      setEmployeeCountByProjectCode({});
      return;
    }

    const { data, error: countError } = await supabase
      .from("employees")
      .select("contract_project")
      .in("contract_project", projectCodes);

    if (countError) {
      // Keep prior counts if the refresh fails; delete/deactivate still works.
      return;
    }

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const code = row.contract_project as string | null;
      if (!code) continue;
      counts[code] = (counts[code] ?? 0) + 1;
    }
    setEmployeeCountByProjectCode(counts);
  }

  async function refreshData() {
    const [{ data: projectRows, error: projectError }, { data: siteRows, error: siteError }] =
      await Promise.all([
        applyBusinessUnitScope(
          supabase.from("projects").select(PROJECT_SELECT),
          buReadScope,
        ).order("project_name", { ascending: true }),
        supabase
          .from("sites")
          .select(SITE_ASSIGNMENT_SELECT)
          .order("site_name", { ascending: true }),
      ]);

    if (projectError || siteError) {
      await alertError(projectError ?? siteError ?? "Refresh failed.");
      return;
    }

    const nextProjects = (
      (projectRows as unknown as ProjectEntry[] | null) ?? []
    ).map((project) => normalizeProjectEntry(project));

    setProjects(nextProjects);
    setSites(
      ((siteRows as unknown as SiteEntry[] | null) ?? []).map((site) =>
        normalizeSiteEntry(site),
      ),
    );
    await refreshEmployeeCounts(nextProjects.map((project) => project.project_code));
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
      service_contract_id: project.service_contract_id ?? "",
      contract_type: project.contract_type === "adhoc" ? "adhoc" : "contract",
    });
    setShowContractForm(true);
  }

  async function handleArchiveContract(projectCode: string) {
    if (!(await confirmArchiveEntry("contract/project"))) {
      return;
    }

    setArchivingCode(projectCode);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setArchivingCode(null);
      await alertError(buContext.error);
      return;
    }

    const existing = projects.find((project) => project.project_code === projectCode);
    try {
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        existing?.business_unit_id,
      );
    } catch (accessError) {
      setArchivingCode(null);
      await alertError(formatBusinessUnitAccessError(accessError));
      return;
    }

    const { error: archiveError } = await tenantScopedUpdate(
      supabase,
      "projects",
      scopedTenantId,
      { is_archived: true },
      { project_code: projectCode },
    );

    if (archiveError) {
      setArchivingCode(null);
      await alertError("Unable to deactivate this contract/project. Try again.");
      return;
    }

    if (editingCode === projectCode) {
      closeContractForm();
    }

    await refreshData();
    setArchivingCode(null);
    toast("Contract deactivated.");
  }

  async function handleReactivateContract(projectCode: string) {
    if (!(await confirmReactivateEntry("contract/project"))) {
      return;
    }

    setReactivatingCode(projectCode);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setReactivatingCode(null);
      await alertError(buContext.error);
      return;
    }

    const existing = projects.find((project) => project.project_code === projectCode);
    try {
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        existing?.business_unit_id,
      );
    } catch (accessError) {
      setReactivatingCode(null);
      await alertError(formatBusinessUnitAccessError(accessError));
      return;
    }

    const { error: reactivateError } = await tenantScopedUpdate(
      supabase,
      "projects",
      scopedTenantId,
      { is_archived: false },
      { project_code: projectCode },
    );

    if (reactivateError) {
      setReactivatingCode(null);
      await alertError("Unable to reactivate this contract/project. Try again.");
      return;
    }

    await refreshData();
    setReactivatingCode(null);
    toast("Contract reactivated.");
  }

  async function handleDeleteContract(projectCode: string) {
    if (!(await confirmDeleteEntry())) {
      return;
    }

    setDeletingCode(projectCode);

    const assignedEmployees = initialEmployeeCountByProjectCode[projectCode] ?? 0;
    if (assignedEmployees > 0) {
      setDeletingCode(null);
      await alertError(formatProjectDeleteBlockedByEmployeesMessage(assignedEmployees));
      return;
    }

    const { error: deleteError } = await tenantScopedDelete(
      supabase,
      "projects",
      scopedTenantId,
      { project_code: projectCode },
    );

    if (deleteError) {
      setDeletingCode(null);
      await alertError(getProjectDeleteErrorMessage(deleteError));
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
    toast("Contract deleted.");
  }

  async function handleContractSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (contractSaveLock.current) {
      return;
    }
    contractSaveLock.current = true;
    setLoading(true);
    contractNameRef.current?.setCustomValidity("");

    try {
      const buContext = await loadWriteBusinessUnitContext(supabase);
      if (!buContext.ok) {
        await alertError(buContext.error);
        return;
      }

      const stampResult = resolveWriteBusinessUnitIdForCreate({
        allowedUnits: buContext.allowedUnits,
        stamp: stampBusinessUnit,
      });
      if (!stampResult.ok) {
        await alertError(stampResult.error);
        return;
      }

      const serviceContractId =
        contractForm.service_contract_id.trim() || null;

      const payload = {
        project_name: contractForm.project_name.trim(),
        service_contract_id: serviceContractId,
        contract_type: contractForm.contract_type,
      };

      const { data: nameRows, error: nameError } = await supabase
        .from("projects")
        .select("project_code, project_name, is_archived")
        .eq("tenant_id", scopedTenantId);
      if (nameError) {
        await alertError(nameError.message);
        return;
      }
      const duplicate = findActiveContractNameDuplicate(
        payload.project_name,
        nameRows ?? [],
        editingCode,
      );
      if (duplicate) {
        const nameField = contractNameRef.current;
        if (nameField) {
          nameField.setCustomValidity(
            duplicateContractNameMessage(
              payload.project_name,
              duplicate.project_code,
            ),
          );
          nameField.reportValidity();
        }
        return;
      }

      if (editingCode) {
        const existing = projects.find(
          (project) => project.project_code === editingCode,
        );
        try {
          assertCanModifyBusinessUnitRow(
            buContext.allowedUnits,
            existing?.business_unit_id,
          );
        } catch (accessError) {
          await alertError(formatBusinessUnitAccessError(accessError));
          return;
        }
      }

      let createdCode: string | null = null;
      if (!editingCode) {
        const allocated = await allocateProjectCode(supabase);
        if (allocated.error || !allocated.projectCode) {
          await alertError(
            allocated.error ?? "Unable to allocate a project code.",
          );
          return;
        }
        createdCode = allocated.projectCode;
      }

      const { error: saveError } = editingCode
        ? await tenantScopedUpdate(
            supabase,
            "projects",
            scopedTenantId,
            {
              project_name: payload.project_name,
              service_contract_id: payload.service_contract_id,
              contract_type: payload.contract_type,
            },
            { project_code: editingCode },
          )
        : await supabase.from("projects").insert({
            project_code: createdCode,
            project_name: payload.project_name,
            service_contract_id: payload.service_contract_id,
            contract_type: payload.contract_type,
            tenant_id: scopedTenantId,
            business_unit_id: stampResult.businessUnitId,
          });

      if (saveError) {
        await alertError(saveError.message);
        return;
      }

      closeContractForm();
      await refreshData();
      toast(
        editingCode ? "Contract updated." : `Contract created — ${createdCode}`,
      );
    } finally {
      contractSaveLock.current = false;
      setLoading(false);
    }
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

    const trimmed = siteStaffValue.trim();
    const requiredStaff =
      trimmed === "" ? null : Number.parseInt(trimmed, 10);
    const staffInput = document.getElementById(`project-required-staff-${siteCode}`);

    if (trimmed !== "" && Number.isNaN(requiredStaff)) {
      setLoading(false);
      if (staffInput instanceof HTMLInputElement) {
        staffInput.setCustomValidity("Required staff must be a whole number.");
        staffInput.reportValidity();
      }
      return;
    }
    if (staffInput instanceof HTMLInputElement) {
      staffInput.setCustomValidity("");
    }

    const { error: saveError } = await tenantScopedUpdate(
      supabase,
      "sites",
      scopedTenantId,
      { required_staff: requiredStaff },
      { site_code: siteCode },
    );

    if (saveError) {
      setLoading(false);
      await alertError(saveError);
      return;
    }

    closeEditSiteStaff();
    await refreshData();
    setLoading(false);
    toast("Required staff saved.");
  }

  return (
    <div className="min-w-0 space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            Manage contract projects and assign operational sites to each
            contract. Contracts with employees assigned can be deactivated
            instead of deleted so history is preserved.
          </p>
          <button
            type="button"
            onClick={() => (showContractForm ? closeContractForm() : openAddContractForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showContractForm ? "Cancel" : "Add Contract"}
          </button>
        </div>

        {showContractForm ? (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
              {editingCode ? "Edit Contract" : "New Contract"}
            </h3>
            <form onSubmit={handleContractSubmit} className="space-y-4">
              <fieldset disabled={loading} className="grid gap-4 md:grid-cols-2 disabled:opacity-70">
                {editingCode ? (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Project Code
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={editingCode}
                      className={`${inputClassName} bg-slate-50 text-slate-600`}
                    />
                  </div>
                ) : null}
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Contract / Project Name
                  </label>
                  <input
                    ref={contractNameRef}
                    name="project_name"
                    type="text"
                    required
                    value={contractForm.project_name}
                    onChange={(event) => {
                      event.target.setCustomValidity("");
                      setContractForm((current) => ({
                        ...current,
                        project_name: event.target.value,
                      }));
                    }}
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Type
                  </label>
                  <select
                    value={contractForm.contract_type}
                    onChange={(event) =>
                      setContractForm((current) => ({
                        ...current,
                        contract_type:
                          event.target.value === "adhoc" ? "adhoc" : "contract",
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="contract">Contract</option>
                    <option value="adhoc">Ad hoc</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Ad hoc is a one-off job, such as fumigation.
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Client Contract
                  </label>
                  <select
                    value={contractForm.service_contract_id}
                    onChange={(event) =>
                      setContractForm((current) => ({
                        ...current,
                        service_contract_id: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="">None (internal / overhead)</option>
                    {serviceContractFormOptions.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {formatServiceContractOptionLabel(contract)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Link this site to the client contract it serves. Sites with
                    no contract are treated as company overhead.
                  </p>
                </div>
              </fieldset>
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

        <div className="mb-3 max-w-xs">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Type
          </label>
          <select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(
                event.target.value === "contract" || event.target.value === "adhoc"
                  ? event.target.value
                  : "",
              )
            }
            className={inputClassName}
          >
            <option value="">All types</option>
            <option value="contract">Contract</option>
            <option value="adhoc">Ad hoc</option>
          </select>
        </div>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Project Code</th>
                <th className={scrollableTableThClassName}>Contract Name</th>
                <th className={scrollableTableThClassName}>
                  <button
                    type="button"
                    className="font-semibold"
                    onClick={() =>
                      setTypeSort((current) =>
                        current === "asc" ? "desc" : "asc",
                      )
                    }
                  >
                    Type{typeSort === "asc" ? " ↑" : typeSort === "desc" ? " ↓" : ""}
                  </button>
                </th>
                <th className={scrollableTableThClassName}>Client Contract</th>
                <th className={scrollableTableThClassName}>Customer</th>
                <th className={scrollableTableThClassName}>Sites</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {contractProjects.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No contract projects configured yet.
                  </td>
                </tr>
              ) : (
                contractProjects.map((project, index) => {
                  const employeeCount =
                    employeeCountByProjectCode[project.project_code] ?? 0;
                  const hasAssignedEmployees = employeeCount > 0;
                  const showDeactivateAction =
                    !project.is_archived && hasAssignedEmployees;

                  return (
                    <tr
                      key={project.id}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3">{project.project_code}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{project.project_name}</span>
                          {project.is_archived ? (
                            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">
                              Inactive
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {project.contract_type === "adhoc" ? "Ad hoc" : "Contract"}
                      </td>
                      <td className="px-4 py-3">
                        {formatProjectClientContractLabel(
                          project.service_contract_id,
                          serviceContractsById,
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {getProjectClientName(project, sites, initialClients)}
                      </td>
                      <td className="px-4 py-3">{getProjectSiteCount(project)}</td>
                      <RegisterRowActions
                        onEdit={() => openEditContractForm(project)}
                        onDelete={
                          showDeactivateAction || project.is_archived
                            ? undefined
                            : () => handleDeleteContract(project.project_code)
                        }
                        onArchive={
                          showDeactivateAction
                            ? () => handleArchiveContract(project.project_code)
                            : undefined
                        }
                        onRestore={
                          project.is_archived
                            ? () => handleReactivateContract(project.project_code)
                            : undefined
                        }
                        deleting={deletingCode === project.project_code}
                        archiving={archivingCode === project.project_code}
                        restoring={reactivatingCode === project.project_code}
                        archiveLabel="Deactivate"
                      />
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#0f2744]">
          Sites on this contract
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[280px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Contract
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
                  {project.is_archived ? " (Inactive)" : ""}
                </option>
              ))}
            </select>
          </div>
          {selectedProject ? (
            <p className="text-sm text-slate-600">
              {formatCountNoun(assignedSites.length, "site")} on{" "}
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
                  <th className={scrollableTableThClassName}>Customer</th>
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
                      <td className="px-4 py-3">
                        {getSiteClientName(site, initialClients)}
                      </td>
                      <td className="px-4 py-3">{getSiteBuildingZone(site)}</td>
                      <td className="px-4 py-3">
                        {editingSiteCode === site.site_code ? (
                          <input
                            id={`project-required-staff-${site.site_code}`}
                            type="number"
                            min={0}
                            value={siteStaffValue}
                            onChange={(event) => {
                              event.currentTarget.setCustomValidity("");
                              setSiteStaffValue(event.target.value);
                            }}
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
                            Required staff
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
