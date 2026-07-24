"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
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
import { formatDate, inputClassName } from "../hr-payroll/hr-register-utils";
import {
  CONTRACT_STATUS_OPTIONS,
  isContractExpired,
  isContractRenewalDue,
  nullableText,
} from "./operations-register-utils";
import {
  DEFAULT_CONTRACT_STATUS,
  type ClientEntry,
} from "./clients-utils";
import {
  allocateClientId,
  allocateContractNumber,
} from "../crm/customers/customer-contract-api";

type ClientsProps = {
  initialClients: ClientEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
};

const emptyForm = {
  client_id: "",
  client_name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  gps_location: "",
  contract_number: "",
  contract_start: "",
  contract_end: "",
  service_frequency: "",
  services_provided: "",
  assigned_supervisor: "",
  contract_status: DEFAULT_CONTRACT_STATUS,
  notes: "",
};

export default function Clients({
  initialClients,
  initialEmployees,
  fetchError,
}: ClientsProps) {
  const supabase = createClient();
  const [clients, setClients] = useState(initialClients);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    setClients(initialClients);
  }, [initialClients]);

  const filteredClients = useMemo(() => {
    return clients.filter((client) => {
      if (filterStatus && (client.contract_status ?? "") !== filterStatus) {
        return false;
      }

      return true;
    });
  }, [clients, filterStatus]);

  async function refreshClients() {
    const { data, error: refreshError } = await supabase
      .from("customers")
      .select("*")
      .order("client_name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setClients((data as ClientEntry[] | null) ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      contract_status: DEFAULT_CONTRACT_STATUS,
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(client: ClientEntry) {
    setEditingId(client.client_id);
    setForm({
      client_id: client.client_id,
      client_name: client.client_name,
      contact_person: client.contact_person ?? "",
      phone: client.phone ?? "",
      email: client.email ?? "",
      address: client.address ?? "",
      gps_location: client.gps_location ?? "",
      contract_number: client.contract_number ?? "",
      contract_start: client.contract_start
        ? toDateInputValue(client.contract_start)
        : "",
      contract_end: client.contract_end
        ? toDateInputValue(client.contract_end)
        : "",
      service_frequency: client.service_frequency ?? "",
      services_provided: client.services_provided ?? "",
      assigned_supervisor: client.assigned_supervisor ?? "",
      contract_status: client.contract_status ?? DEFAULT_CONTRACT_STATUS,
      notes: client.notes ?? "",
    });
    setShowForm(true);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleDelete(clientId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(clientId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("customers")
      .delete()
      .eq("client_id", clientId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === clientId) {
      closeForm();
    }

    await refreshClients();
    setDeletingId(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      client_id: form.client_id.trim(),
      client_name: form.client_name.trim(),
      contact_person: nullableText(form.contact_person),
      phone: nullableText(form.phone),
      email: nullableText(form.email),
      address: nullableText(form.address),
      gps_location: nullableText(form.gps_location),
      contract_number: nullableText(form.contract_number),
      contract_start: nullableText(form.contract_start),
      contract_end: nullableText(form.contract_end),
      service_frequency: nullableText(form.service_frequency),
      services_provided: nullableText(form.services_provided),
      assigned_supervisor: nullableText(form.assigned_supervisor),
      contract_status: nullableText(form.contract_status) ?? DEFAULT_CONTRACT_STATUS,
      notes: nullableText(form.notes),
    };

    if (editingId) {
      const { error: saveError } = await supabase
        .from("customers")
        .update({
          client_name: payload.client_name,
          contact_person: payload.contact_person,
          phone: payload.phone,
          email: payload.email,
          address: payload.address,
          gps_location: payload.gps_location,
          contract_number: payload.contract_number,
          contract_start: payload.contract_start,
          contract_end: payload.contract_end,
          service_frequency: payload.service_frequency,
          services_provided: payload.services_provided,
          assigned_supervisor: payload.assigned_supervisor,
          contract_status: payload.contract_status,
          notes: payload.notes,
        })
        .eq("client_id", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const clientAllocated = await allocateClientId(supabase);
      if (clientAllocated.error || !clientAllocated.clientId) {
        setError(clientAllocated.error ?? "Unable to allocate customer ID.");
        setLoading(false);
        return;
      }

      const contractAllocated = await allocateContractNumber(supabase);
      if (contractAllocated.error || !contractAllocated.contractNumber) {
        setError(
          contractAllocated.error ?? "Unable to allocate contract number.",
        );
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase.from("customers").insert({
        ...payload,
        client_id: clientAllocated.clientId,
        contract_number: contractAllocated.contractNumber,
      });

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    }

    closeForm();
    await refreshClients();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Filter by Contract Status
          </label>
          <select
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value)}
            className={inputClassName}
          >
            <option value="">All statuses</option>
            {CONTRACT_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Customer"}
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
            {editingId ? "Edit Customer" : "New Customer"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {editingId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Customer ID
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={form.client_id}
                    className={`${inputClassName} bg-slate-50 text-slate-600`}
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Customer Name
                </label>
                <input
                  type="text"
                  required
                  value={form.client_name}
                  onChange={(event) =>
                    updateField("client_name", event.target.value)
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
                  value={form.contact_person}
                  onChange={(event) =>
                    updateField("contact_person", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Phone
                </label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => updateField("email", event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Contract Status
                </label>
                <select
                  value={form.contract_status}
                  onChange={(event) =>
                    updateField("contract_status", event.target.value)
                  }
                  className={inputClassName}
                >
                  {CONTRACT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              {editingId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Contract Number
                  </label>
                  <input
                    type="text"
                    value={form.contract_number}
                    onChange={(event) =>
                      updateField("contract_number", event.target.value)
                    }
                    className={inputClassName}
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Contract Start
                </label>
                <input
                  type="date"
                  value={form.contract_start}
                  onChange={(event) =>
                    updateField("contract_start", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Contract End
                </label>
                <input
                  type="date"
                  value={form.contract_end}
                  onChange={(event) =>
                    updateField("contract_end", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Service Frequency
                </label>
                <input
                  type="text"
                  value={form.service_frequency}
                  onChange={(event) =>
                    updateField("service_frequency", event.target.value)
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
                  Address
                </label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(event) =>
                    updateField("address", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  GPS Location
                </label>
                <input
                  type="text"
                  value={form.gps_location}
                  onChange={(event) =>
                    updateField("gps_location", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Services Provided
                </label>
                <input
                  type="text"
                  value={form.services_provided}
                  onChange={(event) =>
                    updateField("services_provided", event.target.value)
                  }
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
                  rows={3}
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
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Customer"}
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
              <th className={scrollableTableThClassName}>Customer Name</th>
              <th className={scrollableTableThClassName}>Contact Person</th>
              <th className={scrollableTableThClassName}>Phone</th>
              <th className={scrollableTableThClassName}>Contract Status</th>
              <th className={scrollableTableThClassName}>Contract End Date</th>
              <th className={scrollableTableThClassName}>Assigned Supervisor</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredClients.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No customers match the selected filters.
                </td>
              </tr>
            ) : (
              filteredClients.map((client, index) => {
                const renewalDue = isContractRenewalDue(client.contract_end);
                const expired = isContractExpired(client.contract_end);
                const rowClassName = renewalDue
                  ? expired
                    ? "bg-red-50 text-slate-700"
                    : "bg-amber-50 text-slate-700"
                  : getStripedRowClassName(index);

                return (
                  <tr key={client.client_id} className={rowClassName}>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      <span className="inline-flex items-center gap-2">
                        {renewalDue ? (
                          <span
                            aria-hidden
                            className={expired ? "text-red-600" : "text-amber-600"}
                            title={
                              expired
                                ? "Contract expired — renewal needed"
                                : "Contract ending within 30 days"
                            }
                          >
                            ⚠
                          </span>
                        ) : null}
                        {client.client_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">{client.contact_person ?? "—"}</td>
                    <td className="px-4 py-3">{client.phone ?? "—"}</td>
                    <td className="px-4 py-3">{client.contract_status ?? "—"}</td>
                    <td className="px-4 py-3">
                      {client.contract_end
                        ? formatDate(client.contract_end)
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {client.assigned_supervisor
                        ? getEmployeeDisplayName(
                            initialEmployees,
                            client.assigned_supervisor,
                          )
                        : "—"}
                    </td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(client)}
                      onDelete={() => handleDelete(client.client_id)}
                      deleting={deletingId === client.client_id}
                    />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
