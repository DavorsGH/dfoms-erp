"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { ClientEntry } from "../operations/clients-utils";
import type { ServiceType } from "../service-types";
import {
  calculateOutstanding,
  formatDate,
  formatGHS,
  getIncomeCustomerDisplayName,
  SERVICE_INCOME_REGISTER_SELECT,
  normalizeIncomeRegisterEntry,
  type IncomeRegisterEntry,
} from "./income-register-utils";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "./register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

type IncomeRegisterProps = {
  initialEntries: IncomeRegisterEntry[];
  initialServiceTypes: ServiceType[];
  initialClients: ClientEntry[];
  fetchError: string | null;
};

const emptyForm = {
  date: "",
  invoice_no: "",
  client_id: "",
  customer_name: "",
  service_category: "",
  description: "",
  amount: "",
  amount_received: "",
  payment_status: "",
  due_date: "",
  notes: "",
};

const PAYMENT_STATUS_OPTIONS = ["Pending", "Partial", "Paid", "Overdue"];

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function IncomeRegister({
  initialEntries,
  initialServiceTypes,
  initialClients,
  fetchError,
}: IncomeRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeIncomeRegisterEntry),
  );
  const [serviceTypes, setServiceTypes] = useState(initialServiceTypes);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    if (!showForm) {
      return;
    }

    const client = createClient();

    async function loadServiceTypes() {
      const { data, error: refreshError } = await client
        .from("service_types")
        .select("name")
        .order("name", { ascending: true });

      if (refreshError) {
        setError(refreshError.message);
        return;
      }

      setServiceTypes(data ?? []);
    }

    loadServiceTypes();
  }, [showForm]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("income_register")
      .select(SERVICE_INCOME_REGISTER_SELECT)
      .or("entry_type.eq.service,entry_type.is.null")
      .order("date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as IncomeRegisterEntry[] | null) ?? []).map((entry) =>
        normalizeIncomeRegisterEntry(entry),
      ),
    );
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: IncomeRegisterEntry) {
    setEditingId(entry.id);
    setForm({
      date: toDateInputValue(entry.date),
      invoice_no: entry.invoice_no,
      client_id: entry.client_id ?? "",
      customer_name: entry.customer_name ?? "",
      service_category: entry.service_category ?? "",
      description: entry.description ?? "",
      amount: String(entry.amount),
      amount_received: String(entry.amount_received),
      payment_status: entry.payment_status,
      due_date: toDateInputValue(entry.due_date),
      notes: entry.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("income_register")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === id) {
      closeForm();
    }

    await refreshEntries();
    setDeletingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const amount = Number(form.amount);
    const amountReceived = Number(form.amount_received);
    const outstandingBalance = calculateOutstanding(amount, amountReceived);
    const clientId = form.client_id.trim() || null;
    const otherPayerName = form.customer_name.trim() || null;

    if (!clientId && !otherPayerName) {
      setError("Select a contract client or enter an other payer name.");
      setLoading(false);
      return;
    }

    const payload = {
      date: form.date,
      invoice_no: form.invoice_no,
      client_id: clientId,
      customer_name: clientId ? null : otherPayerName,
      entry_type: "service" as const,
      service_category: form.service_category,
      description: form.description || null,
      amount,
      amount_received: amountReceived,
      outstanding_balance: outstandingBalance,
      payment_status: form.payment_status,
      due_date: form.due_date,
      notes: form.notes || null,
    };

    const { error: saveError } = editingId
      ? await supabase.from("income_register").update(payload).eq("id", editingId)
      : await supabase.from("income_register").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshEntries();
    setLoading(false);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const previewOutstanding = calculateOutstanding(
    Number(form.amount) || 0,
    Number(form.amount_received) || 0,
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Track invoices, receipts, and outstanding balances.
        </p>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Entry"}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit Income Entry" : "New Income Entry"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date
                </label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Invoice No.
                </label>
                <input
                  type="text"
                  required
                  value={form.invoice_no}
                  onChange={(e) => updateField("invoice_no", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Contract Client
                </label>
                <select
                  value={form.client_id}
                  onChange={(e) => updateField("client_id", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select contract client</option>
                  {initialClients.map((client) => (
                    <option key={client.client_id} value={client.client_id}>
                      {client.client_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Other Payer Name
                </label>
                <input
                  type="text"
                  value={form.customer_name}
                  onChange={(e) => updateField("customer_name", e.target.value)}
                  placeholder="Optional — for one-off payers not in clients list"
                  disabled={Boolean(form.client_id)}
                  className={`${inputClassName}${form.client_id ? " bg-slate-50 text-slate-600" : ""}`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Service Category
                </label>
                <select
                  required
                  value={form.service_category}
                  onChange={(e) =>
                    updateField("service_category", e.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select category</option>
                  {serviceTypes.map((category) => (
                    <option key={category.name} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Amount
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.amount}
                  onChange={(e) => updateField("amount", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Amount Received
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.amount_received}
                  onChange={(e) => updateField("amount_received", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Status
                </label>
                <select
                  required
                  value={form.payment_status}
                  onChange={(e) => updateField("payment_status", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select status</option>
                  {PAYMENT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Due Date
                </label>
                <input
                  type="date"
                  required
                  value={form.due_date}
                  onChange={(e) => updateField("due_date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Description
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  className={inputClassName}
                />
              </div>
            </div>

            <p className="text-sm text-slate-600">
              Outstanding Balance:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(previewOutstanding)}
              </span>
            </p>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Saving…"
                  : editingId
                    ? "Save Changes"
                    : "Save Entry"}
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
      )}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Invoice No.</th>
              <th className={scrollableTableThClassName}>Customer Name</th>
              <th className={scrollableTableThClassName}>Service Category</th>
              <th className={scrollableTableThClassName}>Amount</th>
              <th className={scrollableTableThClassName}>Amount Received</th>
              <th className={scrollableTableThClassName}>Outstanding Balance</th>
              <th className={scrollableTableThClassName}>Payment Status</th>
              <th className={scrollableTableThClassName}>Due Date</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No income register entries yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => {
                const outstanding = calculateOutstanding(
                  entry.amount,
                  entry.amount_received,
                );

                return (
                  <tr
                    key={entry.id}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3">{formatDate(entry.date)}</td>
                    <td className="px-4 py-3">{entry.invoice_no}</td>
                    <td className="px-4 py-3">
                      {getIncomeCustomerDisplayName(entry, initialClients)}
                    </td>
                    <td className="px-4 py-3">{entry.service_category ?? "—"}</td>
                    <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                    <td className="px-4 py-3">
                      {formatGHS(entry.amount_received)}
                    </td>
                    <td className="px-4 py-3">{formatGHS(outstanding)}</td>
                    <td className="px-4 py-3">{entry.payment_status}</td>
                    <td className="px-4 py-3">{formatDate(entry.due_date)}</td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(entry)}
                      onDelete={() => handleDelete(entry.id)}
                      deleting={deletingId === entry.id}
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
