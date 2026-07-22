"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { mapApproverRows } from "../approver-utils";
import type { Approver, NamedLookup } from "../lookup-types";
import {
  calculateAmount,
  formatDate,
  formatGHS,
  type ExpenseRegisterEntry,
} from "./expense-register-utils";
import { resolveManualExpenseReceiptNo } from "./expense-register-api";
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

type ExpenseRegisterProps = {
  initialEntries: ExpenseRegisterEntry[];
  initialExpenseCategories: NamedLookup[];
  initialExpenseSubcategories: NamedLookup[];
  initialPaymentMethods: NamedLookup[];
  initialApprovers: Approver[];
  fetchError: string | null;
};

const emptyForm = {
  date: "",
  expense_category: "",
  sub_category: "",
  description: "",
  vendor: "",
  price: "",
  quantity: "",
  payment_method: "",
  approved_by: "",
  receipt_no: "",
  payment_status: "",
  notes: "",
};

const PAYMENT_STATUS_OPTIONS = ["Pending", "Partial", "Paid", "Overdue"];

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function ExpenseRegister({
  initialEntries,
  initialExpenseCategories,
  initialExpenseSubcategories,
  initialPaymentMethods,
  initialApprovers,
  fetchError,
}: ExpenseRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(initialEntries);
  const [expenseCategories, setExpenseCategories] = useState(
    initialExpenseCategories,
  );
  const [expenseSubcategories, setExpenseSubcategories] = useState(
    initialExpenseSubcategories,
  );
  const [paymentMethods, setPaymentMethods] = useState(initialPaymentMethods);
  const [approvers, setApprovers] = useState(initialApprovers);
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
        { data: methods, error: methodsError },
        { data: approverRows, error: approversError },
      ] = await Promise.all([
        client
          .from("expense_categories")
          .select("name")
          .order("name", { ascending: true }),
        client
          .from("expense_subcategories")
          .select("name")
          .order("name", { ascending: true }),
        client
          .from("payment_methods")
          .select("name")
          .order("name", { ascending: true }),
        client
          .from("approvers")
          .select("employee_id, employees!approvers_employee_id_fkey(full_name)")
          .order("employee_id", { ascending: true }),
      ]);

      const lookupError =
        categoriesError?.message ??
        subcategoriesError?.message ??
        methodsError?.message ??
        approversError?.message ??
        null;

      if (lookupError) {
        setError(lookupError);
        return;
      }

      setExpenseCategories(categories ?? []);
      setExpenseSubcategories(subcategories ?? []);
      setPaymentMethods(methods ?? []);
      setApprovers(mapApproverRows(approverRows ?? []));
    }

    loadLookups();
  }, [showForm]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("expense_register")
      .select("*")
      .order("date", { ascending: false });

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

  function openEditForm(entry: ExpenseRegisterEntry) {
    setEditingId(entry.id);
    setForm({
      date: toDateInputValue(entry.date),
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      description: entry.description ?? "",
      vendor: entry.vendor,
      price: String(entry.price),
      quantity: String(entry.quantity),
      payment_method: entry.payment_method,
      approved_by: entry.approved_by,
      receipt_no: entry.receipt_no,
      payment_status: entry.payment_status,
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
      .from("expense_register")
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

    const price = Number(form.price);
    const quantity = form.quantity.trim() === "" ? 1 : Number(form.quantity);
    const amount = calculateAmount(price, quantity);

    let receiptNo = form.receipt_no.trim();
    if (!editingId) {
      // Create only: blank → generate_next_code('EXP'); filled → keep vendor paper receipt #.
      const resolved = await resolveManualExpenseReceiptNo(supabase, form.receipt_no);
      if (resolved.error || !resolved.receiptNo) {
        setError(resolved.error ?? "Unable to allocate receipt number.");
        setLoading(false);
        return;
      }
      receiptNo = resolved.receiptNo;
    }

    const payload = {
      date: form.date,
      expense_category: form.expense_category,
      sub_category: form.sub_category,
      description: form.description || null,
      vendor: form.vendor,
      price,
      quantity,
      amount,
      payment_method: form.payment_method,
      approved_by: form.approved_by,
      receipt_no: receiptNo,
      payment_status: form.payment_status,
      notes: form.notes || null,
    };

    const { error: saveError } = editingId
      ? await supabase
          .from("expense_register")
          .update(payload)
          .eq("id", editingId)
      : await supabase.from("expense_register").insert(payload);

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

  const previewAmount = calculateAmount(
    Number(form.price) || 0,
    form.quantity.trim() === "" ? 1 : Number(form.quantity) || 1,
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Track expenses, receipts, and payment status.
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
            {editingId ? "Edit Expense Entry" : "New Expense Entry"}
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
                  Vendor
                </label>
                <input
                  type="text"
                  required
                  value={form.vendor}
                  onChange={(e) => updateField("vendor", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Price
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.price}
                  onChange={(e) => updateField("price", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.quantity}
                  onChange={(e) => updateField("quantity", e.target.value)}
                  placeholder="1"
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Method
                </label>
                <select
                  required
                  value={form.payment_method}
                  onChange={(e) => updateField("payment_method", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select payment method</option>
                  {paymentMethods.map((method) => (
                    <option key={method.name} value={method.name}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Approved By
                </label>
                <select
                  required
                  value={form.approved_by}
                  onChange={(e) => updateField("approved_by", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select approver</option>
                  {approvers.map((approver) => (
                    <option key={approver.employee_id} value={approver.full_name}>
                      {approver.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Receipt No.
                </label>
                <input
                  type="text"
                  value={form.receipt_no}
                  onChange={(e) => updateField("receipt_no", e.target.value)}
                  placeholder={
                    editingId
                      ? undefined
                      : "Leave blank to auto-assign, or enter vendor receipt #"
                  }
                  className={inputClassName}
                />
                {!editingId ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Leave blank for an internal code (e.g. DF-EXP-0001), or type
                    the number printed on the vendor&apos;s paper receipt.
                  </p>
                ) : null}
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
              Amount:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(previewAmount)}
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
                <th className={scrollableTableThClassName}>Expense Category</th>
                <th className={scrollableTableThClassName}>Sub-Category</th>
                <th className={scrollableTableThClassName}>Description</th>
                <th className={scrollableTableThClassName}>Vendor</th>
                <th className={scrollableTableThClassName}>Amount</th>
                <th className={scrollableTableThClassName}>Payment Method</th>
                <th className={scrollableTableThClassName}>Payment Status</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No expense register entries yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry, index) => (
                  <tr
                    key={entry.id}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3">{formatDate(entry.date)}</td>
                    <td className="px-4 py-3">{entry.expense_category}</td>
                    <td className="px-4 py-3">{entry.sub_category}</td>
                    <td className="px-4 py-3">{entry.description ?? "—"}</td>
                    <td className="px-4 py-3">{entry.vendor}</td>
                    <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                    <td className="px-4 py-3">{entry.payment_method}</td>
                    <td className="px-4 py-3">{entry.payment_status}</td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(entry)}
                      onDelete={() => handleDelete(entry.id)}
                      deleting={deletingId === entry.id}
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
