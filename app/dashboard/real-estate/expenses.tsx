"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import type { LandlordListRow } from "./landlords-utils";
import {
  CUSTOM_EXPENSE_CATEGORY_VALUE,
  EXPENSE_CATEGORY_OPTIONS,
  formatExpenseCategory,
  formatExpenseDate,
  formatExpenseMoney,
  isExpensePresetCategory,
  sumExpenseAmounts,
  uniqueExpenseCategories,
  type ExpenseListRow,
  type ExpensePropertyOption,
  type ExpensePresetCategory,
} from "./expenses-utils";

type ExpensesProps = {
  landlords: LandlordListRow[];
  selectedLandlordId: string | null;
  properties: ExpensePropertyOption[];
  selectedPropertyId: string | null;
  initialRows: ExpenseListRow[];
  landlordsError: string | null;
  expensesError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

const emptyForm = {
  categoryMode: "other" as ExpensePresetCategory | typeof CUSTOM_EXPENSE_CATEGORY_VALUE,
  customCategory: "",
  amount_ghs: "",
  expense_date: todayInputValue(),
  description: "",
};

function resolveCategoryValue(
  mode: ExpensePresetCategory | typeof CUSTOM_EXPENSE_CATEGORY_VALUE,
  customCategory: string,
): string | null {
  if (mode === CUSTOM_EXPENSE_CATEGORY_VALUE) {
    const trimmed = customCategory.trim();
    return trimmed || null;
  }
  return mode;
}

function categoryModeFromStored(
  category: string,
): {
  categoryMode: ExpensePresetCategory | typeof CUSTOM_EXPENSE_CATEGORY_VALUE;
  customCategory: string;
} {
  if (isExpensePresetCategory(category)) {
    return { categoryMode: category, customCategory: "" };
  }
  return {
    categoryMode: CUSTOM_EXPENSE_CATEGORY_VALUE,
    customCategory: category,
  };
}

export default function Expenses({
  landlords,
  selectedLandlordId,
  properties,
  selectedPropertyId,
  initialRows,
  landlordsError,
  expensesError,
}: ExpensesProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(
    landlordsError ?? expensesError,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    ...emptyForm,
    receipt_url: "" as string,
  });
  const [editReceiptFile, setEditReceiptFile] = useState<File | null>(null);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    setError(landlordsError ?? expensesError);
  }, [landlordsError, expensesError]);

  useEffect(() => {
    setShowForm(false);
    setEditingExpenseId(null);
    setForm({ ...emptyForm, expense_date: todayInputValue() });
    setReceiptFile(null);
    setCategoryFilter("");
    setSuccess(null);
  }, [selectedLandlordId, selectedPropertyId]);

  const selectedLandlord = landlords.find(
    (row) => row.tenantId === selectedLandlordId,
  );
  const selectedProperty = properties.find(
    (row) => row.propertyId === selectedPropertyId,
  );

  const filteredRows = useMemo(() => {
    if (!categoryFilter) {
      return rows;
    }
    return rows.filter((row) => row.category === categoryFilter);
  }, [rows, categoryFilter]);

  const filterCategories = useMemo(
    () => uniqueExpenseCategories(rows),
    [rows],
  );

  const filteredTotal = sumExpenseAmounts(filteredRows);

  function buildExpensesUrl(landlordId: string | null, propertyId: string | null) {
    if (!landlordId) {
      return "/dashboard/real-estate/expenses";
    }
    const params = new URLSearchParams();
    params.set("landlord", landlordId);
    if (propertyId) {
      params.set("property", propertyId);
    }
    return `/dashboard/real-estate/expenses?${params.toString()}`;
  }

  function handleLandlordChange(tenantId: string) {
    router.push(buildExpensesUrl(tenantId || null, null));
  }

  function handlePropertyChange(propertyId: string) {
    if (!selectedLandlordId) {
      return;
    }
    router.push(buildExpensesUrl(selectedLandlordId, propertyId || null));
  }

  async function uploadReceipt(expenseId: string, file: File) {
    if (!selectedLandlordId) {
      return { ok: false as const, error: "Landlord is required." };
    }

    const formData = new FormData();
    formData.set("tenant_id", selectedLandlordId);
    formData.set("expense_id", expenseId);
    formData.set("file", file);

    const response = await fetch("/api/admin/expenses/upload-receipt", {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      receipt_url?: string;
    } | null;

    if (!response.ok) {
      return {
        ok: false as const,
        error: payload?.error ?? "Unable to upload receipt.",
      };
    }

    return {
      ok: true as const,
      receiptUrl: payload?.receipt_url ?? null,
    };
  }

  function openEdit(row: ExpenseListRow) {
    setError(null);
    setSuccess(null);
    setShowForm(false);
    setEditingExpenseId(row.expenseId);
    const categoryParts = categoryModeFromStored(row.category);
    setEditForm({
      categoryMode: categoryParts.categoryMode,
      customCategory: categoryParts.customCategory,
      amount_ghs: String(row.amountGhs),
      expense_date: row.expenseDate.slice(0, 10),
      description: row.description ?? "",
      receipt_url: row.receiptUrl ?? "",
    });
    setEditReceiptFile(null);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId || !selectedPropertyId) {
      return;
    }

    const category = resolveCategoryValue(
      form.categoryMode,
      form.customCategory,
    );
    if (!category) {
      setError("Enter a custom category name.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/expenses/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        property_id: selectedPropertyId,
        category,
        amount_ghs: form.amount_ghs,
        expense_date: form.expense_date,
        description: form.description || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      expense_id?: string;
    } | null;

    if (!response.ok || !payload?.expense_id) {
      setError(payload?.error ?? "Unable to create expense.");
      setLoading(false);
      return;
    }

    if (receiptFile) {
      const uploadResult = await uploadReceipt(payload.expense_id, receiptFile);
      if (!uploadResult.ok) {
        setError(
          `Expense created, but receipt upload failed: ${uploadResult.error}`,
        );
        setLoading(false);
        setShowForm(false);
        setForm({ ...emptyForm, expense_date: todayInputValue() });
        setReceiptFile(null);
        router.refresh();
        return;
      }
    }

    setShowForm(false);
    setForm({ ...emptyForm, expense_date: todayInputValue() });
    setReceiptFile(null);
    setLoading(false);
    setSuccess("Expense created.");
    router.refresh();
  }

  async function handleUpdate(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId || !editingExpenseId) {
      return;
    }

    const category = resolveCategoryValue(
      editForm.categoryMode,
      editForm.customCategory,
    );
    if (!category) {
      setError("Enter a custom category name.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/expenses/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        expense_id: editingExpenseId,
        category,
        amount_ghs: editForm.amount_ghs,
        expense_date: editForm.expense_date,
        description: editForm.description || null,
        receipt_url: editForm.receipt_url || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update expense.");
      setLoading(false);
      return;
    }

    if (editReceiptFile) {
      const uploadResult = await uploadReceipt(
        editingExpenseId,
        editReceiptFile,
      );
      if (!uploadResult.ok) {
        setError(
          `Expense updated, but receipt upload failed: ${uploadResult.error}`,
        );
        setLoading(false);
        setEditReceiptFile(null);
        router.refresh();
        return;
      }
    }

    setEditingExpenseId(null);
    setEditReceiptFile(null);
    setLoading(false);
    setSuccess("Expense updated.");
    router.refresh();
  }

  async function handleDelete(expenseId: string) {
    if (!selectedLandlordId) {
      return;
    }
    if (!window.confirm("Delete this expense entry? This cannot be undone.")) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/expenses/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        expense_id: expenseId,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to delete expense.");
      setLoading(false);
      return;
    }

    if (editingExpenseId === expenseId) {
      setEditingExpenseId(null);
    }
    setLoading(false);
    setSuccess("Expense deleted.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 md:max-w-3xl">
        <div>
          <label
            htmlFor="expenses-landlord-picker"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Landlord
          </label>
          <select
            id="expenses-landlord-picker"
            className={inputClassName}
            value={selectedLandlordId ?? ""}
            onChange={(event) => handleLandlordChange(event.target.value)}
          >
            <option value="">Select a Davors-managed landlord…</option>
            {landlords.map((landlord) => (
              <option key={landlord.tenantId} value={landlord.tenantId}>
                {landlord.name}
              </option>
            ))}
          </select>
        </div>

        {selectedLandlordId ? (
          <div>
            <label
              htmlFor="expenses-property-picker"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Property
            </label>
            <select
              id="expenses-property-picker"
              className={inputClassName}
              value={selectedPropertyId ?? ""}
              onChange={(event) => handlePropertyChange(event.target.value)}
            >
              <option value="">Select a property…</option>
              {properties.map((property) => (
                <option key={property.propertyId} value={property.propertyId}>
                  {property.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      {!selectedLandlordId ? (
        <p className="text-sm text-slate-600">
          Select a Davors-managed landlord, then a property, to manage expenses.
        </p>
      ) : !selectedPropertyId ? (
        <p className="text-sm text-slate-600">
          {properties.length === 0
            ? "This landlord has no properties yet. Add a property first."
            : "Select a property to view and record expenses."}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#0f2744]">
                {selectedProperty?.name ?? "Property"}
              </h2>
              <p className="text-sm text-slate-600">
                Expenses for {selectedLandlord?.name ?? "this landlord"}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-900">
                Total (filtered): {formatExpenseMoney(filteredTotal)}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="expenses-category-filter"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Filter by category
                </label>
                <select
                  id="expenses-category-filter"
                  className={inputClassName}
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="">All categories</option>
                  {filterCategories.map((category) => (
                    <option key={category} value={category}>
                      {formatExpenseCategory(category)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className={primaryButtonClassName}
                disabled={loading}
                onClick={() => {
                  setShowForm((current) => !current);
                  setEditingExpenseId(null);
                  setForm({ ...emptyForm, expense_date: todayInputValue() });
                  setReceiptFile(null);
                  setError(null);
                  setSuccess(null);
                }}
              >
                {showForm ? "Cancel" : "Add Expense"}
              </button>
            </div>
          </div>

          {showForm ? (
            <form
              onSubmit={handleCreate}
              className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h3 className="text-base font-semibold text-[#0f2744]">
                Add Expense
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="expense-category"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Category
                  </label>
                  <select
                    id="expense-category"
                    required
                    className={inputClassName}
                    value={form.categoryMode}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        categoryMode: event.target
                          .value as typeof current.categoryMode,
                        customCategory:
                          event.target.value === CUSTOM_EXPENSE_CATEGORY_VALUE
                            ? current.customCategory
                            : "",
                      }))
                    }
                  >
                    {EXPENSE_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    <option value={CUSTOM_EXPENSE_CATEGORY_VALUE}>
                      Custom…
                    </option>
                  </select>
                  {form.categoryMode === CUSTOM_EXPENSE_CATEGORY_VALUE ? (
                    <input
                      id="expense-custom-category"
                      required
                      type="text"
                      className={`${inputClassName} mt-2`}
                      value={form.customCategory}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          customCategory: event.target.value,
                        }))
                      }
                      placeholder="Type a custom category"
                    />
                  ) : null}
                </div>
                <div>
                  <label
                    htmlFor="expense-amount"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Amount (GHS)
                  </label>
                  <input
                    id="expense-amount"
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClassName}
                    value={form.amount_ghs}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        amount_ghs: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label
                    htmlFor="expense-date"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Expense date
                  </label>
                  <input
                    id="expense-date"
                    required
                    type="date"
                    className={inputClassName}
                    value={form.expense_date}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        expense_date: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-700">
                    Receipt (optional)
                  </p>
                  <ImageFileUploadButton
                    inputId="expense-receipt"
                    files={receiptFile ? [receiptFile] : []}
                    onChange={(next) => setReceiptFile(next[0] ?? null)}
                    multiple={false}
                    addLabel="Add receipt"
                    changeLabel="Change receipt"
                  />
                </div>
                <div className="md:col-span-2">
                  <label
                    htmlFor="expense-description"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Description (optional)
                  </label>
                  <textarea
                    id="expense-description"
                    rows={3}
                    className={textareaClassName}
                    value={form.description}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <button
                type="submit"
                className={primaryButtonClassName}
                disabled={loading}
              >
                {loading ? "Saving…" : "Create expense"}
              </button>
            </form>
          ) : null}

          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Category</th>
                  <th className={scrollableTableThClassName}>Amount</th>
                  <th className={scrollableTableThClassName}>Date</th>
                  <th className={scrollableTableThClassName}>Description</th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-sm text-slate-500"
                    >
                      No expenses for this property
                      {categoryFilter ? " in the selected category" : ""}.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, index) => (
                    <tr
                      key={row.expenseId}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3 text-sm text-slate-900">
                        {formatExpenseCategory(row.category)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-900">
                        {formatExpenseMoney(row.amountGhs)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatExpenseDate(row.expenseDate)}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-sm text-slate-700">
                        <span className="line-clamp-2">
                          {row.description || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={secondaryButtonClassName}
                            disabled={loading}
                            onClick={() =>
                              editingExpenseId === row.expenseId
                                ? setEditingExpenseId(null)
                                : openEdit(row)
                            }
                          >
                            {editingExpenseId === row.expenseId
                              ? "Close"
                              : "Edit"}
                          </button>
                          <button
                            type="button"
                            className={dangerButtonClassName}
                            disabled={loading}
                            onClick={() => handleDelete(row.expenseId)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>

          {editingExpenseId ? (
            <form
              onSubmit={handleUpdate}
              className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h3 className="text-base font-semibold text-[#0f2744]">
                Edit Expense
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="edit-expense-category"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Category
                  </label>
                  <select
                    id="edit-expense-category"
                    required
                    className={inputClassName}
                    value={editForm.categoryMode}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        categoryMode: event.target
                          .value as typeof current.categoryMode,
                        customCategory:
                          event.target.value === CUSTOM_EXPENSE_CATEGORY_VALUE
                            ? current.customCategory
                            : "",
                      }))
                    }
                  >
                    {EXPENSE_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    <option value={CUSTOM_EXPENSE_CATEGORY_VALUE}>
                      Custom…
                    </option>
                  </select>
                  {editForm.categoryMode === CUSTOM_EXPENSE_CATEGORY_VALUE ? (
                    <input
                      id="edit-expense-custom-category"
                      required
                      type="text"
                      className={`${inputClassName} mt-2`}
                      value={editForm.customCategory}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          customCategory: event.target.value,
                        }))
                      }
                      placeholder="Type a custom category"
                    />
                  ) : null}
                </div>
                <div>
                  <label
                    htmlFor="edit-expense-amount"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Amount (GHS)
                  </label>
                  <input
                    id="edit-expense-amount"
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClassName}
                    value={editForm.amount_ghs}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        amount_ghs: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label
                    htmlFor="edit-expense-date"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Expense date
                  </label>
                  <input
                    id="edit-expense-date"
                    required
                    type="date"
                    className={inputClassName}
                    value={editForm.expense_date}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        expense_date: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-700">
                    Replace receipt
                  </p>
                  <ImageFileUploadButton
                    inputId="edit-expense-receipt"
                    files={editReceiptFile ? [editReceiptFile] : []}
                    onChange={(next) => setEditReceiptFile(next[0] ?? null)}
                    multiple={false}
                    addLabel="Add receipt"
                    changeLabel="Change receipt"
                  />
                </div>
                <div className="md:col-span-2">
                  <label
                    htmlFor="edit-expense-description"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Description (optional)
                  </label>
                  <textarea
                    id="edit-expense-description"
                    rows={3}
                    className={textareaClassName}
                    value={editForm.description}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              {editForm.receipt_url ? (
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={editForm.receipt_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-[#0f2744] hover:underline"
                  >
                    View current receipt
                  </a>
                  <button
                    type="button"
                    className={secondaryButtonClassName}
                    onClick={() =>
                      setEditForm((current) => ({
                        ...current,
                        receipt_url: "",
                      }))
                    }
                  >
                    Remove receipt
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No receipt attached.</p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className={primaryButtonClassName}
                  disabled={loading}
                >
                  {loading ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  disabled={loading}
                  onClick={() => setEditingExpenseId(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}
