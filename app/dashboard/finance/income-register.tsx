"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { ServiceType } from "../service-types";
import {
  calculateOutstanding,
  formatDate,
  formatGHS,
  type IncomeRegisterEntry,
} from "./income-register-utils";

type IncomeRegisterProps = {
  initialEntries: IncomeRegisterEntry[];
  initialServiceTypes: ServiceType[];
  fetchError: string | null;
};

const emptyForm = {
  date: "",
  invoice_no: "",
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
  fetchError,
}: IncomeRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(initialEntries);
  const [serviceTypes, setServiceTypes] = useState(initialServiceTypes);
  const [showForm, setShowForm] = useState(false);
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
      .select("*")
      .order("date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(data ?? []);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const amount = Number(form.amount);
    const amountReceived = Number(form.amount_received);
    const outstandingBalance = calculateOutstanding(amount, amountReceived);

    const { error: insertError } = await supabase.from("income_register").insert({
      date: form.date,
      invoice_no: form.invoice_no,
      customer_name: form.customer_name,
      service_category: form.service_category,
      description: form.description || null,
      amount,
      amount_received: amountReceived,
      outstanding_balance: outstandingBalance,
      payment_status: form.payment_status,
      due_date: form.due_date,
      notes: form.notes || null,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setForm(emptyForm);
    setShowForm(false);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Track invoices, receipts, and outstanding balances.
        </p>
        <button
          type="button"
          onClick={() => setShowForm((current) => !current)}
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
            New Income Entry
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
                  Customer Name
                </label>
                <input
                  type="text"
                  required
                  value={form.customer_name}
                  onChange={(e) => updateField("customer_name", e.target.value)}
                  className={inputClassName}
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
                  onChange={(e) =>
                    updateField("amount_received", e.target.value)
                  }
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
                  onChange={(e) =>
                    updateField("payment_status", e.target.value)
                  }
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

            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save Entry"}
            </button>
          </form>
        </section>
      )}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#0f2744] text-white">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Invoice No.</th>
                <th className="px-4 py-3 font-medium">Customer Name</th>
                <th className="px-4 py-3 font-medium">Service Category</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Amount Received</th>
                <th className="px-4 py-3 font-medium">Outstanding Balance</th>
                <th className="px-4 py-3 font-medium">Payment Status</th>
                <th className="px-4 py-3 font-medium">Due Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No income register entries yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const outstanding = calculateOutstanding(
                    entry.amount,
                    entry.amount_received,
                  );

                  return (
                    <tr key={entry.id} className="text-slate-700">
                      <td className="px-4 py-3">{formatDate(entry.date)}</td>
                      <td className="px-4 py-3">{entry.invoice_no}</td>
                      <td className="px-4 py-3">{entry.customer_name}</td>
                      <td className="px-4 py-3">{entry.service_category}</td>
                      <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                      <td className="px-4 py-3">
                        {formatGHS(entry.amount_received)}
                      </td>
                      <td className="px-4 py-3">{formatGHS(outstanding)}</td>
                      <td className="px-4 py-3">{entry.payment_status}</td>
                      <td className="px-4 py-3">{formatDate(entry.due_date)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
