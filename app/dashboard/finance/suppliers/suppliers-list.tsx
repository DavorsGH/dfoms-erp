"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { inputClassName } from "../../employees/employee-record-utils";
import {
  getStripedRowClassName,
  registerTableActionsInnerClassName,
} from "../../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableActionsTdClassName,
  scrollableTableActionsThClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableIdentifyingThClassName,
  scrollableTableRegisterStickyNameWrapTdClassName,
  scrollableTableThClassName,
} from "../../scrollable-table";
import FilteredListCount from "../../filtered-list-count";
import {
  emptySupplierForm,
  formatSupplierStatus,
  normalizeSupplier,
  SUPPLIER_STATUS_FILTER_OPTIONS,
  supplierToForm,
  validateSupplierInput,
  type SupplierRow,
} from "@/utils/suppliers-types";

type SuppliersListProps = {
  initialSuppliers: SupplierRow[];
  fetchError: string | null;
  readOnly?: boolean;
};

type FormState = ReturnType<typeof emptySupplierForm>;

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const editButtonClassName =
  "rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const deleteButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

function formatCell(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

export default function SuppliersList({
  initialSuppliers,
  fetchError,
  readOnly = false,
}: SuppliersListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [showForm, setShowForm] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptySupplierForm());
  const [loading, setLoading] = useState(false);
  const [deletingSupplierId, setDeletingSupplierId] = useState<string | null>(null);
  const [checkingSupplierId, setCheckingSupplierId] = useState<string | null>(null);
  const [confirmingSupplierId, setConfirmingSupplierId] = useState<string | null>(
    null,
  );
  const [blockedSupplierMessage, setBlockedSupplierMessage] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    setSuppliers(initialSuppliers);
  }, [initialSuppliers]);

  const editingSupplier = useMemo(
    () =>
      editingSupplierId
        ? suppliers.find((supplier) => supplier.id === editingSupplierId) ?? null
        : null,
    [editingSupplierId, suppliers],
  );

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((supplier) => {
      if (!filterStatus) {
        return true;
      }
      if (filterStatus === "active") {
        return supplier.is_active;
      }
      if (filterStatus === "inactive") {
        return !supplier.is_active;
      }
      return true;
    });
  }, [filterStatus, suppliers]);

  async function refreshSuppliers() {
    const response = await fetch("/api/suppliers");
    const payload = (await response.json().catch(() => null)) as
      | { suppliers?: SupplierRow[]; error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to refresh suppliers.");
      return;
    }

    setSuppliers(
      (payload?.suppliers ?? []).map((row) => normalizeSupplier(row)),
    );
    setError(null);
  }

  function openAddForm() {
    setEditingSupplierId(null);
    setForm(emptySupplierForm());
    setShowForm(true);
    setError(null);
    setSuccess(null);
  }

  function openEditForm(supplier: SupplierRow) {
    setEditingSupplierId(supplier.id);
    setForm(supplierToForm(supplier));
    setShowForm(true);
    setError(null);
    setSuccess(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingSupplierId(null);
    setForm(emptySupplierForm());
  }

  const editFromQueryHandled = useRef<string | null>(null);

  useEffect(() => {
    const editId = searchParams.get("edit")?.trim();
    if (!editId || editFromQueryHandled.current === editId) {
      return;
    }
    const supplier = suppliers.find((row) => row.id === editId);
    if (!supplier) {
      return;
    }
    editFromQueryHandled.current = editId;
    openEditForm(supplier);
    router.replace("/dashboard/finance/suppliers", { scroll: false });
  }, [router, searchParams, suppliers]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const validationError = validateSupplierInput(form);
    if (validationError) {
      setError(validationError);
      setLoading(false);
      return;
    }

    const isEditing = Boolean(editingSupplierId);
    const response = await fetch(
      isEditing ? `/api/suppliers/${editingSupplierId}` : "/api/suppliers",
      {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      },
    );

    const payload = (await response.json().catch(() => null)) as
      | { supplier?: SupplierRow; error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save supplier.");
      setLoading(false);
      return;
    }

    if (payload?.supplier) {
      const normalized = normalizeSupplier(payload.supplier);
      setSuppliers((current) => {
        if (isEditing) {
          return current
            .map((supplier) =>
              supplier.id === normalized.id ? normalized : supplier,
            )
            .sort((a, b) => a.name.localeCompare(b.name));
        }

        return [...current, normalized].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      });
    } else {
      await refreshSuppliers();
    }

    setSuccess(isEditing ? "Supplier updated." : "Supplier created.");
    closeForm();
    setLoading(false);
    router.refresh();
  }

  async function previewDelete(supplier: SupplierRow) {
    setCheckingSupplierId(supplier.id);
    setConfirmingSupplierId(null);
    setBlockedSupplierMessage(null);
    setError(null);
    setSuccess(null);

    try {
      const previewResponse = await fetch(`/api/suppliers/${supplier.id}`, {
        method: "DELETE",
      });

      const previewPayload = (await previewResponse.json().catch(() => null)) as
        | {
            can_delete?: boolean;
            error?: string;
            requires_confirmation?: boolean;
          }
        | null;

      if (
        previewResponse.status === 409 ||
        previewPayload?.can_delete === false
      ) {
        setBlockedSupplierMessage({
          id: supplier.id,
          text: previewPayload?.error ?? "This supplier can't be deleted.",
        });
        return;
      }

      if (
        !previewResponse.ok ||
        previewPayload?.can_delete !== true ||
        !previewPayload.requires_confirmation
      ) {
        setError(previewPayload?.error ?? "Unable to preview supplier delete.");
        return;
      }

      setConfirmingSupplierId(supplier.id);
    } catch {
      setError("Unable to preview supplier delete. Try again.");
    } finally {
      setCheckingSupplierId(null);
    }
  }

  async function confirmDelete(supplier: SupplierRow) {
    setDeletingSupplierId(supplier.id);
    setError(null);

    try {
      const deleteResponse = await fetch(`/api/suppliers/${supplier.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });

      const deletePayload = (await deleteResponse.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!deleteResponse.ok) {
        setError(deletePayload?.error ?? "Unable to delete supplier.");
        return;
      }

      if (editingSupplierId === supplier.id) {
        closeForm();
      }

      setSuppliers((current) =>
        current.filter((row) => row.id !== supplier.id),
      );
      setConfirmingSupplierId(null);
      setBlockedSupplierMessage(null);
      setSuccess("Supplier deleted.");
      router.refresh();
    } catch {
      setError("Unable to delete supplier. Try again.");
    } finally {
      setDeletingSupplierId(null);
    }
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
              {SUPPLIER_STATUS_FILTER_OPTIONS.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => (showForm ? closeForm() : openAddForm())}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
            >
              {showForm ? "Cancel" : "Add Supplier"}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      {showForm && !readOnly ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingSupplier ? "Edit Supplier" : "New Supplier"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Supplier Name
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
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
                    setForm((current) => ({
                      ...current,
                      contact_person: event.target.value,
                    }))
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
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
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
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Terms (days)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={form.payment_terms_days}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      payment_terms_days: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Address
                </label>
                <textarea
                  rows={3}
                  value={form.address}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      address: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        is_active: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                  />
                  Active supplier
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  Uncheck to hide this supplier from purchase dropdowns while
                  keeping historical records.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className={primaryButtonClassName}
              >
                {loading
                  ? "Saving…"
                  : editingSupplier
                    ? "Save Changes"
                    : "Add Supplier"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={loading}
                className={secondaryButtonClassName}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <FilteredListCount
        filteredCount={filteredSuppliers.length}
        totalCount={suppliers.length}
        itemSingular="supplier"
        hasActiveFilters={Boolean(filterStatus)}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableIdentifyingThClassName}>Supplier Name</th>
              <th className={scrollableTableThClassName}>Contact Person</th>
              <th className={scrollableTableThClassName}>Email</th>
              <th className={scrollableTableThClassName}>Phone</th>
              <th className={scrollableTableThClassName}>Payment Terms (days)</th>
              <th className={scrollableTableThClassName}>Status</th>
              {!readOnly ? (
                <th className={scrollableTableActionsThClassName}>Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredSuppliers.length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? 6 : 7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No suppliers match the selected filters.
                </td>
              </tr>
            ) : (
              filteredSuppliers.map((supplier, index) => (
                <tr key={supplier.id} className={getStripedRowClassName(index)}>
                  <td
                    className={`${scrollableTableRegisterStickyNameWrapTdClassName({
                      striped: index % 2 === 1,
                    })} font-medium text-[#0f2744]`}
                  >
                    <Link
                      href={`/dashboard/finance/suppliers/${supplier.id}`}
                      className="min-w-0 max-w-full cursor-pointer whitespace-normal text-left font-medium text-sky-800 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                    >
                      {supplier.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{formatCell(supplier.contact_person)}</td>
                  <td className="px-4 py-3">{formatCell(supplier.email)}</td>
                  <td className="px-4 py-3">{formatCell(supplier.phone)}</td>
                  <td className="px-4 py-3">{supplier.payment_terms_days}</td>
                  <td className="px-4 py-3">
                    {formatSupplierStatus(supplier.is_active)}
                  </td>
                  {!readOnly ? (
                    <td className={scrollableTableActionsTdClassName}>
                      <div className={registerTableActionsInnerClassName}>
                        {confirmingSupplierId === supplier.id ? (
                          <>
                            <span className="whitespace-normal text-sm text-red-700">
                              Delete {supplier.name}? This cannot be undone.
                            </span>
                            <button
                              type="button"
                              onClick={() => void confirmDelete(supplier)}
                              disabled={deletingSupplierId === supplier.id}
                              className={deleteButtonClassName}
                            >
                              {deletingSupplierId === supplier.id
                                ? "Deleting…"
                                : "Yes, delete"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingSupplierId(null)}
                              disabled={deletingSupplierId === supplier.id}
                              className={editButtonClassName}
                            >
                              Cancel
                            </button>
                          </>
                        ) : blockedSupplierMessage?.id === supplier.id ? (
                          <>
                            <span className="max-w-md whitespace-normal text-sm text-red-700">
                              {blockedSupplierMessage.text}
                            </span>
                            <button
                              type="button"
                              onClick={() => setBlockedSupplierMessage(null)}
                              className={editButtonClassName}
                            >
                              Dismiss
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditForm(supplier)}
                              disabled={
                                loading ||
                                checkingSupplierId === supplier.id ||
                                deletingSupplierId === supplier.id
                              }
                              className={editButtonClassName}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void previewDelete(supplier)}
                              disabled={checkingSupplierId === supplier.id}
                              className={deleteButtonClassName}
                            >
                              {checkingSupplierId === supplier.id
                                ? "Checking…"
                                : "Delete"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
