"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { NamedLookup } from "../lookup-types";
import {
  calculateBalanceDue,
  calculateDaysOutstanding,
  calculateStatus,
  formatDate,
  formatGHS,
  type AccountsPayableEntry,
} from "./accounts-payable-utils";
import RegisterRowActions, {
  confirmDeleteEntry,
  toDateInputValue,
} from "./register-row-actions";

type AccountsPayableProps = {
  initialEntries: AccountsPayableEntry[];
  initialExpenseCategories: NamedLookup[];
  initialExpenseSubcategories: NamedLookup[];
  fetchError: string | null;
};

const emptyForm = {
  vendor_name: "",
  invoice_number: "",
  expense_category: "",
  sub_category: "",
  description: "",
  invoice_date: "",
  due_date: "",
  amount: "",
  amount_paid: "",
  notes: "",
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const overdueClassName = "font-medium text-red-700";

export default function AccountsPayable({
  initialEntries,
  initialExpenseCategories,
  initialExpenseSubcategories,
  fetchError,
}: AccountsPayableProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(initialEntries);
  const [expenseCategories, setExpenseCategories] = useState(
    initialExpenseCategories,
  );
  const [expenseSubcategories, setExpenseSubcategories] = useState(
    initialExpenseSubcategories,
  );
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

    async function loadLookups() {
      const [
        { data: categories, error: categoriesError },
        { data: subcategories, error: subcategoriesError },
      ] = await Promise.all([
        client
          .from("expense_categories")
          .select("name")
          .order("name", { ascending: true }),
        client
          .from("expense_subcategories")
          .select("name")
          .order("name", { ascending: true }),
      ]);

      const lookupError =
        categoriesError?.message ?? subcategoriesError?.message ?? null;

      if (lookupError) {
        setError(lookupError);
        return;
      }

      setExpenseCategories(categories ?? []);
      setExpenseSubcategories(subcategories ?? []);
    }

    loadLookups();
  }, [showForm]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("accounts_payable")
      .select("*")
      .order("due_date", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(data ?? []);
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

  function openEditForm(entry: AccountsPayableEntry) {
    setEditingId(entry.id);
    setForm({
      vendor_name: entry.vendor_name,
      invoice_number: entry.invoice_number,
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      description: entry.description ?? "",
      invoice_date: toDateInputValue(entry.invoice_date),
      due_date: toDateInputValue(entry.due_date),
      amount: String(entry.amount),
      amount_paid: String(entry.amount_paid),
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
      .from("accounts_payable")
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
    const amountPaid = Number(form.amount_paid);
    const balanceDue = calculateBalanceDue(amount, amountPaid);
    const daysOutstanding = calculateDaysOutstanding(form.due_date);
    const status = calculateStatus(balanceDue, daysOutstanding);

    const payload = {
      vendor_name: form.vendor_name,
      invoice_number: form.invoice_number,
      expense_category: form.expense_category,
      sub_category: form.sub_category,
      description: form.description || null,
      invoice_date: form.invoice_date,
      due_date: form.due_date,
      amount,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      status,
      notes: form.notes || null,
    };

    const { error: saveError } = editingId
      ? await supabase
          .from("accounts_payable")
          .update(payload)
          .eq("id", editingId)
      : await supabase.from("accounts_payable").insert(payload);

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

  const previewBalanceDue = calculateBalanceDue(
    Number(form.amount) || 0,
    Number(form.amount_paid) || 0,
  );
  const previewDaysOutstanding = form.due_date
    ? calculateDaysOutstanding(form.due_date)
    : 0;
  const previewStatus = calculateStatus(
    previewBalanceDue,
    previewDaysOutstanding,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Track vendor invoices, payments, and outstanding balances.
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
            {editingId
              ? "Edit Accounts Payable Entry"
              : "New Accounts Payable Entry"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Vendor Name
                </label>
                <input
                  type="text"
                  required
                  value={form.vendor_name}
                  onChange={(e) => updateField("vendor_name", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Invoice Number
                </label>
                <input
                  type="text"
                  required
                  value={form.invoice_number}
                  onChange={(e) => updateField("invoice_number", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Expense Category
                </label>
                <select
                  required
                  value={form.expense_category}
                  onChange={(e) =>
                    updateField("expense_category", e.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select category</option>
                  {expenseCategories.map((category) => (
                    <option key={category.name} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Sub-Category
                </label>
                <select
                  required
                  value={form.sub_category}
                  onChange={(e) => updateField("sub_category", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select sub-category</option>
                  {expenseSubcategories.map((subcategory) => (
                    <option key={subcategory.name} value={subcategory.name}>
                      {subcategory.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Invoice Date
                </label>
                <input
                  type="date"
                  required
                  value={form.invoice_date}
                  onChange={(e) => updateField("invoice_date", e.target.value)}
                  className={inputClassName}
                />
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
                  Amount Paid
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.amount_paid}
                  onChange={(e) => updateField("amount_paid", e.target.value)}
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

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
              <p>
                Balance Due:{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatGHS(previewBalanceDue)}
                </span>
              </p>
              <p>
                Days Outstanding:{" "}
                <span
                  className={
                    previewStatus === "Overdue"
                      ? overdueClassName
                      : "font-medium text-[#0f2744]"
                  }
                >
                  {previewDaysOutstanding}
                </span>
              </p>
              <p>
                Status:{" "}
                <span
                  className={
                    previewStatus === "Overdue"
                      ? overdueClassName
                      : "font-medium text-[#0f2744]"
                  }
                >
                  {previewStatus}
                </span>
              </p>
            </div>

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

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#0f2744] text-white">
              <tr>
                <th className="px-4 py-3 font-medium">Vendor Name</th>
                <th className="px-4 py-3 font-medium">Invoice Number</th>
                <th className="px-4 py-3 font-medium">Expense Category</th>
                <th className="px-4 py-3 font-medium">Sub-Category</th>
                <th className="px-4 py-3 font-medium">Invoice Date</th>
                <th className="px-4 py-3 font-medium">Due Date</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Amount Paid</th>
                <th className="px-4 py-3 font-medium">Balance Due</th>
                <th className="px-4 py-3 font-medium">Days Outstanding</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={12}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No accounts payable entries yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const balanceDue = calculateBalanceDue(
                    entry.amount,
                    entry.amount_paid,
                  );
                  const daysOutstanding = calculateDaysOutstanding(
                    entry.due_date,
                  );
                  const status = calculateStatus(balanceDue, daysOutstanding);
                  const isOverdue = status === "Overdue";

                  return (
                    <tr key={entry.id} className="text-slate-700">
                      <td className="px-4 py-3">{entry.vendor_name}</td>
                      <td className="px-4 py-3">{entry.invoice_number}</td>
                      <td className="px-4 py-3">{entry.expense_category}</td>
                      <td className="px-4 py-3">{entry.sub_category}</td>
                      <td className="px-4 py-3">
                        {formatDate(entry.invoice_date)}
                      </td>
                      <td className="px-4 py-3">{formatDate(entry.due_date)}</td>
                      <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                      <td className="px-4 py-3">
                        {formatGHS(entry.amount_paid)}
                      </td>
                      <td className="px-4 py-3">{formatGHS(balanceDue)}</td>
                      <td
                        className={`px-4 py-3 ${isOverdue ? overdueClassName : ""}`}
                      >
                        {daysOutstanding}
                      </td>
                      <td
                        className={`px-4 py-3 ${isOverdue ? overdueClassName : ""}`}
                      >
                        {status}
                      </td>
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
        </div>
      </section>
    </div>
  );
}
