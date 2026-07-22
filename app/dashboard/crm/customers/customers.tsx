"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "../../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../scrollable-table";
import { inputClassName } from "../../hr-payroll/hr-register-utils";
import {
  CONTRACT_STATUS_OPTIONS,
  generateNextOperationsId,
  nullableText,
} from "../../operations/operations-register-utils";
import {
  CUSTOMER_STATUS_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
  DEFAULT_CUSTOMER_STATUS,
  DEFAULT_CUSTOMER_TYPE,
  type CustomerEntry,
} from "./customers-utils";
import { allocateContractNumber } from "./customer-contract-api";
import type { HrEmployee } from "../../hr-payroll/employee-utils";

type CustomersProps = {
  initialCustomers: CustomerEntry[];
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
  contract_status: "Active",
  notes: "",
  customer_type: DEFAULT_CUSTOMER_TYPE,
  status: DEFAULT_CUSTOMER_STATUS,
};

export default function Customers({
  initialCustomers,
  initialEmployees,
  fetchError,
}: CustomersProps) {
  const supabase = createClient();
  const [customers, setCustomers] = useState(initialCustomers);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCustomerType, setFilterCustomerType] = useState("");

  useEffect(() => {
    setCustomers(initialCustomers);
  }, [initialCustomers]);

  const filteredCustomers = useMemo(() => {
    return customers.filter((customer) => {
      if (filterStatus && (customer.status ?? "") !== filterStatus) {
        return false;
      }

      if (filterCustomerType && (customer.customer_type ?? "") !== filterCustomerType) {
        return false;
      }

      return true;
    });
  }, [customers, filterCustomerType, filterStatus]);

  async function refreshCustomers() {
    const { data, error: refreshError } = await supabase
      .from("customers")
      .select("*")
      .order("client_name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setCustomers((data as CustomerEntry[] | null) ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      client_id: generateNextOperationsId(
        "CLI",
        3,
        customers.map((customer) => customer.client_id),
      ),
      customer_type: DEFAULT_CUSTOMER_TYPE,
      status: DEFAULT_CUSTOMER_STATUS,
      contract_status: "Active",
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(customer: CustomerEntry) {
    setEditingId(customer.client_id);
    setForm({
      client_id: customer.client_id,
      client_name: customer.client_name,
      contact_person: customer.contact_person ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
      gps_location: customer.gps_location ?? "",
      contract_number: customer.contract_number ?? "",
      contract_start: customer.contract_start
        ? toDateInputValue(customer.contract_start)
        : "",
      contract_end: customer.contract_end
        ? toDateInputValue(customer.contract_end)
        : "",
      service_frequency: customer.service_frequency ?? "",
      services_provided: customer.services_provided ?? "",
      assigned_supervisor: customer.assigned_supervisor ?? "",
      contract_status: customer.contract_status ?? "Active",
      notes: customer.notes ?? "",
      customer_type: customer.customer_type ?? DEFAULT_CUSTOMER_TYPE,
      status: customer.status ?? DEFAULT_CUSTOMER_STATUS,
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

    await refreshCustomers();
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
      contract_status: nullableText(form.contract_status) ?? "Active",
      notes: nullableText(form.notes),
      customer_type: nullableText(form.customer_type) ?? DEFAULT_CUSTOMER_TYPE,
      status: nullableText(form.status) ?? DEFAULT_CUSTOMER_STATUS,
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
          customer_type: payload.customer_type,
          status: payload.status,
        })
        .eq("client_id", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateContractNumber(supabase);
      if (allocated.error || !allocated.contractNumber) {
        setError(allocated.error ?? "Unable to allocate contract number.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase.from("customers").insert({
        ...payload,
        contract_number: allocated.contractNumber,
      });

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    }

    closeForm();
    await refreshCustomers();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-4">
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Status
            </label>
            <select
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value)}
              className={inputClassName}
            >
              <option value="">All statuses</option>
              {CUSTOMER_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Customer Type
            </label>
            <select
              value={filterCustomerType}
              onChange={(event) => setFilterCustomerType(event.target.value)}
              className={inputClassName}
            >
              <option value="">All types</option>
              {CUSTOMER_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {type}
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
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Client ID
                </label>
                <input
                  type="text"
                  required
                  readOnly
                  value={form.client_id}
                  className={`${inputClassName} bg-slate-50 text-slate-600`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Client Name
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
                  Customer Type
                </label>
                <select
                  value={form.customer_type}
                  onChange={(event) =>
                    updateField("customer_type", event.target.value)
                  }
                  className={inputClassName}
                >
                  {CUSTOMER_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(event) => updateField("status", event.target.value)}
                  className={inputClassName}
                >
                  {CUSTOMER_STATUS_OPTIONS.map((status) => (
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
              <th className={scrollableTableThClassName}>Client Name</th>
              <th className={scrollableTableThClassName}>Contact Person</th>
              <th className={scrollableTableThClassName}>Email</th>
              <th className={scrollableTableThClassName}>Phone</th>
              <th className={scrollableTableThClassName}>Customer Type</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredCustomers.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No customers match the selected filters.
                </td>
              </tr>
            ) : (
              filteredCustomers.map((customer, index) => (
                <tr
                  key={customer.client_id}
                  className={getStripedRowClassName(index)}
                >
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    {customer.client_name}
                  </td>
                  <td className="px-4 py-3">{customer.contact_person ?? "—"}</td>
                  <td className="px-4 py-3">{customer.email ?? "—"}</td>
                  <td className="px-4 py-3">{customer.phone ?? "—"}</td>
                  <td className="px-4 py-3">{customer.customer_type ?? "—"}</td>
                  <td className="px-4 py-3">{customer.status ?? "—"}</td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(customer)}
                    onDelete={() => handleDelete(customer.client_id)}
                    deleting={deletingId === customer.client_id}
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
