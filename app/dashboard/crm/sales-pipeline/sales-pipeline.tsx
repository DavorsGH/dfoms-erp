"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { formatDate, formatGHS } from "../../finance/income-register-utils";
import { inputClassName } from "../../hr-payroll/hr-register-utils";
import type { HrEmployee } from "../../hr-payroll/employee-utils";
import { nullableText } from "../../operations/operations-register-utils";
import type { PipelineClient } from "./sales-pipeline-utils";
import {
  allocateClientId,
  allocateContractNumber,
} from "../customers/customer-contract-api";
import {
  DEFAULT_CUSTOMER_TYPE,
} from "../customers/customers-utils";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import { useStampBusinessUnitId, useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import OpportunityFormFields from "./opportunity-form-fields";
import {
  ACTIVITY_TYPE_OPTIONS,
  OPPORTUNITY_STAGES,
  SALES_ACTIVITY_SELECT,
  SALES_OPPORTUNITY_SELECT,
  emptyOpportunityForm,
  getActivityTypeLabel,
  getAssignedRepLabel,
  getClientName,
  groupOpportunitiesByStage,
  isActivityComplete,
  normalizeSalesActivity,
  normalizeSalesOpportunity,
  opportunityToFormState,
  parseOpportunityForm,
  type OpportunityFormState,
  type OpportunityStage,
  type SalesActivity,
  type SalesActivityType,
  type SalesOpportunity,
} from "./sales-pipeline-utils";

type SalesPipelineProps = {
  initialOpportunities: SalesOpportunity[];
  initialActivities: SalesActivity[];
  initialClients: PipelineClient[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
  /** Create-only stamp; null = All Businesses. */
  activeBusinessUnitId?: string | null;
};

const emptyLeadForm = {
  client_name: "",
  contact_person: "",
  phone: "",
  email: "",
};

const emptyActivityForm = {
  activity_type: "call" as SalesActivityType,
  due_date: "",
  assigned_to: "",
  notes: "",
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function SalesPipeline({
  initialOpportunities,
  initialActivities,
  initialClients,
  initialEmployees,
  fetchError,
  activeBusinessUnitId = null,
}: SalesPipelineProps) {
  const supabase = createClient();
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [activities, setActivities] = useState(initialActivities);
  const [clients, setClients] = useState(initialClients);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingOpportunityId, setEditingOpportunityId] = useState<string | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<SalesOpportunity | null>(null);
  const [createNewLead, setCreateNewLead] = useState(false);
  const [opportunityForm, setOpportunityForm] = useState<OpportunityFormState>(
    emptyOpportunityForm(),
  );
  const [leadForm, setLeadForm] = useState(emptyLeadForm);
  const [expandedOpportunityId, setExpandedOpportunityId] = useState<
    string | null
  >(null);
  const [activityForms, setActivityForms] = useState<
    Record<string, typeof emptyActivityForm>
  >({});
  const [lostReasonDrafts, setLostReasonDrafts] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(false);
  const [stageUpdatingId, setStageUpdatingId] = useState<string | null>(null);
  const [completingActivityId, setCompletingActivityId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setOpportunities(initialOpportunities);
  }, [initialOpportunities]);

  useEffect(() => {
    setActivities(initialActivities);
  }, [initialActivities]);

  useEffect(() => {
    setClients(initialClients);
  }, [initialClients]);

  const groupedOpportunities = useMemo(
    () => groupOpportunitiesByStage(opportunities),
    [opportunities],
  );

  const activitiesByOpportunity = useMemo(() => {
    const map = new Map<string, SalesActivity[]>();
    for (const activity of activities) {
      if (!activity.opportunity_id) continue;
      const existing = map.get(activity.opportunity_id) ?? [];
      existing.push(activity);
      map.set(activity.opportunity_id, existing);
    }
    return map;
  }, [activities]);

  async function refreshOpportunities() {
    const { data, error: refreshError } = await applyBusinessUnitScope(
      supabase
        .from("sales_opportunities")
        .select(SALES_OPPORTUNITY_SELECT),
      buReadScope,
    ).order("updated_at", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setOpportunities(
      ((data as SalesOpportunity[] | null) ?? []).map((row) =>
        normalizeSalesOpportunity(row),
      ),
    );
  }

  async function refreshActivities() {
    const { data, error: refreshError } = await supabase
      .from("sales_activities")
      .select(SALES_ACTIVITY_SELECT)
      .order("due_date", { ascending: true, nullsFirst: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setActivities(
      ((data as SalesActivity[] | null) ?? []).map((row) =>
        normalizeSalesActivity(row),
      ),
    );
  }

  async function refreshClients() {
    const { data, error: refreshError } = await supabase
      .from("customers")
      .select("client_id, client_name, status")
      .order("client_name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setClients((data as PipelineClient[] | null) ?? []);
  }

  function openAddForm() {
    setEditingOpportunityId(null);
    setOpportunityForm(emptyOpportunityForm());
    setLeadForm(emptyLeadForm);
    setCreateNewLead(false);
    setShowAddForm(true);
    setError(null);
  }

  function closeAddForm() {
    setShowAddForm(false);
    setOpportunityForm(emptyOpportunityForm());
    setLeadForm(emptyLeadForm);
    setCreateNewLead(false);
  }

  function openEditForm(opportunity: SalesOpportunity) {
    setShowAddForm(false);
    setEditingOpportunityId(opportunity.id);
    setOpportunityForm(opportunityToFormState(opportunity));
    setError(null);
  }

  function closeEditForm() {
    setEditingOpportunityId(null);
    setOpportunityForm(emptyOpportunityForm());
  }

  function updateOpportunityField(
    field: keyof OpportunityFormState,
    value: string,
  ) {
    setOpportunityForm((current) => ({ ...current, [field]: value }));
  }

  function updateLeadField(field: keyof typeof emptyLeadForm, value: string) {
    setLeadForm((current) => ({ ...current, [field]: value }));
  }

  function getActivityForm(opportunityId: string) {
    return activityForms[opportunityId] ?? emptyActivityForm;
  }

  function updateActivityField(
    opportunityId: string,
    field: keyof typeof emptyActivityForm,
    value: string,
  ) {
    setActivityForms((current) => ({
      ...current,
      [opportunityId]: {
        ...(current[opportunityId] ?? emptyActivityForm),
        [field]: value,
      },
    }));
  }

  async function createLeadClient(): Promise<string | null> {
    const clientName = leadForm.client_name.trim();
    if (!clientName) {
      setError("Lead customer name is required.");
      return null;
    }

    const clientAllocated = await allocateClientId(supabase);
    if (clientAllocated.error || !clientAllocated.clientId) {
      setError(clientAllocated.error ?? "Unable to allocate customer ID.");
      return null;
    }

    const contractAllocated = await allocateContractNumber(supabase);
    if (contractAllocated.error || !contractAllocated.contractNumber) {
      setError(
        contractAllocated.error ?? "Unable to allocate contract number.",
      );
      return null;
    }

    const { error: insertError } = await supabase.from("customers").insert({
      client_id: clientAllocated.clientId,
      client_name: clientName,
      contact_person: nullableText(leadForm.contact_person),
      phone: nullableText(leadForm.phone),
      email: nullableText(leadForm.email),
      contract_number: contractAllocated.contractNumber,
      contract_status: "Active",
      customer_type: DEFAULT_CUSTOMER_TYPE,
      status: "lead",
    });

    if (insertError) {
      setError(insertError.message);
      return null;
    }

    requestTenantAdminDirectorNotification({
      title: "New customer added",
      detail: clientName,
      bodyFormat: "added_by",
      actionUrl: "/dashboard/crm/customers",
    });

    await refreshClients();
    return clientAllocated.clientId;
  }

  async function handleCreateOpportunity(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    if (!stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      setLoading(false);
      return;
    }

    let clientId = opportunityForm.client_id.trim();

    if (createNewLead) {
      const createdClientId = await createLeadClient();
      if (!createdClientId) {
        setLoading(false);
        return;
      }
      clientId = createdClientId;
    }

    if (!clientId) {
      setError("Select a customer or create a new lead customer.");
      setLoading(false);
      return;
    }

    const parsed = parseOpportunityForm({ ...opportunityForm, client_id: clientId });
    if (!parsed.ok) {
      setError(parsed.error);
      setLoading(false);
      return;
    }

    const { data, error: rpcError } = await supabase.rpc(
      "create_sales_opportunity",
      {
        p_client_id: parsed.value.client_id,
        p_opportunity_name: parsed.value.opportunity_name,
        p_estimated_value: parsed.value.estimated_value,
        p_probability: parsed.value.probability,
        p_expected_close_date: parsed.value.expected_close_date,
        p_source: parsed.value.source,
        p_assigned_to: parsed.value.assigned_to,
        p_notes: parsed.value.notes,
        p_business_unit_id: stampBusinessUnit.businessUnitId,
      },
    );

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    if (!data) {
      setError("Opportunity was not created.");
      setLoading(false);
      return;
    }

    closeAddForm();
    await refreshOpportunities();
    setLoading(false);
  }

  async function handleUpdateOpportunity(event: React.FormEvent) {
    event.preventDefault();
    if (!editingOpportunityId) {
      return;
    }

    setLoading(true);
    setError(null);

    const parsed = parseOpportunityForm(opportunityForm);
    if (!parsed.ok) {
      setError(parsed.error);
      setLoading(false);
      return;
    }

    const { error: rpcError } = await supabase.rpc("update_sales_opportunity", {
      p_opportunity_id: editingOpportunityId,
      p_client_id: parsed.value.client_id,
      p_opportunity_name: parsed.value.opportunity_name,
      p_estimated_value: parsed.value.estimated_value,
      p_probability: parsed.value.probability,
      p_expected_close_date: parsed.value.expected_close_date,
      p_source: parsed.value.source,
      p_assigned_to: parsed.value.assigned_to,
      p_notes: parsed.value.notes,
    });

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    closeEditForm();
    await refreshOpportunities();
    setLoading(false);
  }

  async function handleDeleteOpportunity() {
    if (!deleteTarget) {
      return;
    }

    setLoading(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("delete_sales_opportunity", {
      p_opportunity_id: deleteTarget.id,
    });

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    if (expandedOpportunityId === deleteTarget.id) {
      setExpandedOpportunityId(null);
    }
    if (editingOpportunityId === deleteTarget.id) {
      closeEditForm();
    }

    setDeleteTarget(null);
    await Promise.all([refreshOpportunities(), refreshActivities()]);
    setLoading(false);
  }

  async function handleStageChange(
    opportunity: SalesOpportunity,
    newStage: OpportunityStage,
  ) {
    if (newStage === opportunity.stage) {
      return;
    }

    if (newStage === "lost") {
      const lostReason = lostReasonDrafts[opportunity.id]?.trim() ?? "";
      if (!lostReason) {
        setError("Enter a lost reason before moving to Lost.");
        return;
      }
    }

    setStageUpdatingId(opportunity.id);
    setError(null);

    const { error: rpcError } = await supabase.rpc("set_opportunity_stage", {
      p_opportunity_id: opportunity.id,
      p_new_stage: newStage,
      p_lost_reason:
        newStage === "lost"
          ? lostReasonDrafts[opportunity.id]?.trim() ?? null
          : null,
    });

    if (rpcError) {
      setError(rpcError.message);
      setStageUpdatingId(null);
      return;
    }

    await refreshOpportunities();
    if (newStage === "won") {
      await refreshClients();
    }
    setStageUpdatingId(null);
  }

  async function handleAddActivity(
    event: React.FormEvent,
    opportunity: SalesOpportunity,
  ) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const form = getActivityForm(opportunity.id);

    const { data, error: rpcError } = await supabase.rpc(
      "create_sales_activity",
      {
        p_client_id: opportunity.client_id,
        p_opportunity_id: opportunity.id,
        p_activity_type: form.activity_type,
        p_due_date: nullableText(form.due_date) ?? null,
        p_assigned_to: nullableText(form.assigned_to),
        p_notes: nullableText(form.notes),
      },
    );

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    if (!data) {
      setError("Follow-up activity was not created.");
      setLoading(false);
      return;
    }

    setActivityForms((current) => ({
      ...current,
      [opportunity.id]: emptyActivityForm,
    }));
    await refreshActivities();
    setLoading(false);
  }

  async function handleCompleteActivity(activityId: string) {
    setCompletingActivityId(activityId);
    setError(null);

    const { error: rpcError } = await supabase.rpc("complete_sales_activity", {
      p_activity_id: activityId,
    });

    if (rpcError) {
      setError(rpcError.message);
      setCompletingActivityId(null);
      return;
    }

    await refreshActivities();
    setCompletingActivityId(null);
  }

  function toggleExpanded(opportunityId: string) {
    setExpandedOpportunityId((current) =>
      current === opportunityId ? null : opportunityId,
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="text-sm text-slate-600">
          Track opportunities by stage, move deals through the pipeline, and
          log follow-up activities.
        </p>
        <button
          type="button"
          onClick={() => (showAddForm ? closeAddForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showAddForm ? "Cancel" : "Add Opportunity"}
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {showAddForm ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            New Opportunity
          </h3>
          <form onSubmit={handleCreateOpportunity} className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={createNewLead}
                  onChange={(event) => {
                    setCreateNewLead(event.target.checked);
                    if (event.target.checked) {
                      updateOpportunityField("client_id", "");
                    }
                  }}
                />
                Create new lead customer inline
              </label>
            </div>

            {createNewLead ? (
              <div className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Lead Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={leadForm.client_name}
                    onChange={(event) =>
                      updateLeadField("client_name", event.target.value)
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    value={leadForm.contact_person}
                    onChange={(event) =>
                      updateLeadField("contact_person", event.target.value)
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={leadForm.phone}
                    onChange={(event) =>
                      updateLeadField("phone", event.target.value)
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Email
                  </label>
                  <input
                    type="email"
                    value={leadForm.email}
                    onChange={(event) =>
                      updateLeadField("email", event.target.value)
                    }
                    className={inputClassName}
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Customer *
                </label>
                <select
                  required
                  value={opportunityForm.client_id}
                  onChange={(event) =>
                    updateOpportunityField("client_id", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select customer</option>
                  {clients.map((client) => (
                    <option key={client.client_id} value={client.client_id}>
                      {client.client_name}
                      {client.status ? ` (${client.status})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <OpportunityFormFields
              form={opportunityForm}
              clients={clients}
              employees={initialEmployees}
              onFieldChange={updateOpportunityField}
              showCustomerField={false}
            />

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving…" : "Create Opportunity"}
              </button>
              <button
                type="button"
                onClick={closeAddForm}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {editingOpportunityId ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            Edit Opportunity
          </h3>
          <form onSubmit={handleUpdateOpportunity} className="space-y-4">
            <OpportunityFormFields
              form={opportunityForm}
              clients={clients}
              employees={initialEmployees}
              onFieldChange={updateOpportunityField}
            />

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={closeEditForm}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-opportunity-title"
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h3
              id="delete-opportunity-title"
              className="text-lg font-semibold text-[#0f2744]"
            >
              Delete opportunity?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This will permanently remove{" "}
              <span className="font-medium text-slate-800">
                {deleteTarget.opportunity_name}
              </span>{" "}
              and its follow-up activities. Deletion is blocked if quotations or
              product quotes are linked to this opportunity.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={loading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteOpportunity()}
                disabled={loading}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-4">
          {OPPORTUNITY_STAGES.map((stage) => {
            const columnItems = groupedOpportunities[stage.value];

            return (
              <div
                key={stage.value}
                className="flex w-[300px] shrink-0 flex-col rounded-lg border border-slate-200 bg-slate-50"
              >
                <div className="border-b border-slate-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-[#0f2744]">
                    {stage.label}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {columnItems.length} opportunit
                    {columnItems.length === 1 ? "y" : "ies"}
                  </p>
                </div>

                <div className="flex flex-1 flex-col gap-3 p-3">
                  {columnItems.length === 0 ? (
                    <p className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-xs text-slate-500">
                      No opportunities
                    </p>
                  ) : (
                    columnItems.map((opportunity) => {
                      const isExpanded =
                        expandedOpportunityId === opportunity.id;
                      const opportunityActivities =
                        activitiesByOpportunity.get(opportunity.id) ?? [];
                      const activityForm = getActivityForm(opportunity.id);
                      const pendingLostStage =
                        lostReasonDrafts[opportunity.id] !== undefined;

                      return (
                        <article
                          key={opportunity.id}
                          className="rounded-md border border-slate-200 bg-white p-3 shadow-sm"
                        >
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => openEditForm(opportunity)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <p className="font-medium text-[#0f2744] hover:underline">
                                  {opportunity.opportunity_name}
                                </p>
                              </button>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                  type="button"
                                  title="Edit opportunity"
                                  aria-label={`Edit ${opportunity.opportunity_name}`}
                                  onClick={() => openEditForm(opportunity)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-[#3d5a7a] shadow-sm transition-colors hover:border-[#0f2744]/25 hover:bg-[#e8eef4] hover:text-[#0f2744] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0f2744]"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  >
                                    <path d="m2.695 14.763-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.501a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  title="Delete opportunity"
                                  aria-label={`Delete ${opportunity.opportunity_name}`}
                                  onClick={() => setDeleteTarget(opportunity)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-100 bg-red-50 text-red-600 shadow-sm transition-colors hover:border-red-200 hover:bg-red-100 hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-600"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 0 0-.615 1 1.066 1.066 0 0 0-.109.459c0 .298-.032.597-.094.884a.75.75 0 0 0 .686.823c.293-.082.59-.147.884-.195A48.065 48.065 0 0 1 8 4.75v-.15a1.25 1.25 0 0 1 1.25-1.25h1.5A1.25 1.25 0 0 1 12 3.75v.15c.795.077 1.584.176 2.365.298a.75.75 0 0 0 .686-.823 48.065 48.065 0 0 0-.884-.195.75.75 0 0 0-.094-.459 1.066 1.066 0 0 0-.615-1A48.567 48.567 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM6 6.75A.75.75 0 0 1 6.75 6h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 6 6.75Zm1.5 3.75a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            <p className="text-sm text-slate-600">
                              {getClientName(clients, opportunity.client_id)}
                            </p>
                            <p className="text-sm text-slate-700">
                              {opportunity.estimated_value == null
                                ? "—"
                                : formatGHS(opportunity.estimated_value)}
                              {opportunity.probability != null
                                ? ` · ${opportunity.probability}%`
                                : ""}
                            </p>
                            <p className="text-xs text-slate-500">
                              Close:{" "}
                              {opportunity.expected_close_date
                                ? formatDate(opportunity.expected_close_date)
                                : "—"}
                            </p>
                            <p className="text-xs text-slate-500">
                              Rep:{" "}
                              {getAssignedRepLabel(
                                initialEmployees,
                                opportunity.assigned_to,
                              )}
                            </p>
                            {opportunity.lost_reason ? (
                              <p className="text-xs text-red-700">
                                Lost reason: {opportunity.lost_reason}
                              </p>
                            ) : null}
                          </div>

                          <div className="mt-3 space-y-2">
                            <label className="block text-xs font-medium text-slate-600">
                              Stage
                            </label>
                            <select
                              value={opportunity.stage}
                              disabled={stageUpdatingId === opportunity.id}
                              onChange={(event) => {
                                const nextStage = event.target
                                  .value as OpportunityStage;
                                if (nextStage === "lost") {
                                  setLostReasonDrafts((current) => ({
                                    ...current,
                                    [opportunity.id]:
                                      current[opportunity.id] ?? "",
                                  }));
                                  return;
                                }
                                void handleStageChange(opportunity, nextStage);
                              }}
                              className={inputClassName}
                            >
                              {OPPORTUNITY_STAGES.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>

                            {(pendingLostStage ||
                              opportunity.stage === "lost") &&
                            opportunity.stage !== "lost" ? (
                              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                                <label className="block text-xs font-medium text-amber-950">
                                  Lost reason *
                                </label>
                                <input
                                  type="text"
                                  value={lostReasonDrafts[opportunity.id] ?? ""}
                                  onChange={(event) =>
                                    setLostReasonDrafts((current) => ({
                                      ...current,
                                      [opportunity.id]: event.target.value,
                                    }))
                                  }
                                  className={inputClassName}
                                />
                                <button
                                  type="button"
                                  disabled={stageUpdatingId === opportunity.id}
                                  onClick={() =>
                                    void handleStageChange(opportunity, "lost")
                                  }
                                  className="rounded-md bg-[#0f2744] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Confirm Lost
                                </button>
                              </div>
                            ) : null}
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleExpanded(opportunity.id)}
                            className="mt-3 text-xs font-medium text-[#0f2744] underline-offset-2 hover:underline"
                          >
                            {isExpanded ? "Hide follow-ups" : "Follow-ups"}
                            {opportunityActivities.length > 0
                              ? ` (${opportunityActivities.length})`
                              : ""}
                          </button>

                          {isExpanded ? (
                            <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                              {opportunityActivities.length === 0 ? (
                                <p className="text-xs text-slate-500">
                                  No follow-up activities yet.
                                </p>
                              ) : (
                                <ul className="space-y-2">
                                  {opportunityActivities.map((activity) => (
                                    <li
                                      key={activity.id}
                                      className="rounded-md border border-slate-200 px-3 py-2 text-xs"
                                    >
                                      <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div>
                                          <p className="font-medium text-[#0f2744]">
                                            {getActivityTypeLabel(
                                              activity.activity_type,
                                            )}
                                            {isActivityComplete(activity)
                                              ? " · Done"
                                              : " · Open"}
                                          </p>
                                          <p className="text-slate-600">
                                            Due:{" "}
                                            {activity.due_date
                                              ? formatDate(activity.due_date)
                                              : "—"}
                                          </p>
                                          {activity.notes ? (
                                            <p className="mt-1 text-slate-600">
                                              {activity.notes}
                                            </p>
                                          ) : null}
                                        </div>
                                        {!isActivityComplete(activity) ? (
                                          <button
                                            type="button"
                                            disabled={
                                              completingActivityId ===
                                              activity.id
                                            }
                                            onClick={() =>
                                              void handleCompleteActivity(
                                                activity.id,
                                              )
                                            }
                                            className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-900 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            {completingActivityId === activity.id
                                              ? "Saving…"
                                              : "Complete"}
                                          </button>
                                        ) : null}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              <form
                                onSubmit={(event) =>
                                  void handleAddActivity(event, opportunity)
                                }
                                className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3"
                              >
                                <p className="text-xs font-medium text-[#0f2744]">
                                  Add follow-up
                                </p>
                                <div className="grid gap-2">
                                  <select
                                    value={activityForm.activity_type}
                                    onChange={(event) =>
                                      updateActivityField(
                                        opportunity.id,
                                        "activity_type",
                                        event.target.value,
                                      )
                                    }
                                    className={inputClassName}
                                  >
                                    {ACTIVITY_TYPE_OPTIONS.map((option) => (
                                      <option
                                        key={option.value}
                                        value={option.value}
                                      >
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="date"
                                    value={activityForm.due_date}
                                    onChange={(event) =>
                                      updateActivityField(
                                        opportunity.id,
                                        "due_date",
                                        event.target.value,
                                      )
                                    }
                                    className={inputClassName}
                                  />
                                  <select
                                    value={activityForm.assigned_to}
                                    onChange={(event) =>
                                      updateActivityField(
                                        opportunity.id,
                                        "assigned_to",
                                        event.target.value,
                                      )
                                    }
                                    className={inputClassName}
                                  >
                                    <option value="">Unassigned</option>
                                    {initialEmployees.map((employee) => (
                                      <option
                                        key={employee.employee_id}
                                        value={employee.employee_id}
                                      >
                                        {employee.staff_id} — {employee.full_name}
                                      </option>
                                    ))}
                                  </select>
                                  <textarea
                                    rows={2}
                                    value={activityForm.notes}
                                    onChange={(event) =>
                                      updateActivityField(
                                        opportunity.id,
                                        "notes",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Notes"
                                    className={inputClassName}
                                  />
                                </div>
                                <button
                                  type="submit"
                                  disabled={loading}
                                  className="rounded-md bg-[#0f2744] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Add Activity
                                </button>
                              </form>
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
