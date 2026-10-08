"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import {
  confirmInternalUseDelete,
  getStripedRowClassName,
  registerTableActionsInnerClassName,
} from "../finance/register-row-actions";
import {
  scrollableTableActionsTdClassName,
  scrollableTableActionsThClassName,
} from "../scrollable-table";
import type { ContractProjectOption } from "../administration/projects-utils";
import type { SiteEntry } from "../operations/sites-utils";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatInventoryQuantity,
  nullableText,
} from "./inventory-utils";
import type { FinishedProductRecord } from "./finished-products-utils";
import {
  filterInternalConsumptionSites,
  formatInternalUseProductOptionLabel,
  getInternalConsumptionClientName,
  getInternalConsumptionSiteName,
  type InternalConsumptionRecord,
} from "./internal-consumption-utils";
import InventoryCollapsibleHistorySection from "./inventory-collapsible-history-section";
import { mapInternalConsumptionMutationErrorMessage } from "@/lib/inventory/inventory-mutation-error";
import {
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  loadWriteBusinessUnitContext,
} from "@/utils/business-unit-access";

type InternalConsumptionProps = {
  entries: InternalConsumptionRecord[];
  products: FinishedProductRecord[];
  initialProjects: ContractProjectOption[];
  initialSites: SiteEntry[];
  recordedByLabel: string;
  fetchError: string | null;
  readOnly?: boolean;
  /** When true, header/button live on Finished Products; list is collapsible. */
  embedded?: boolean;
  showForm?: boolean;
  onShowFormChange?: (show: boolean) => void;
  /** Refetch lists, product stock, and invalidate server page props. */
  onInventoryMutated: () => Promise<void>;
};

const emptyForm = {
  project_id: "",
  site_id: "",
  product_id: "",
  quantity: "",
  consumption_date: new Date().toISOString().slice(0, 10),
  reason: "",
  notes: "",
};

export default function InternalConsumption({
  entries,
  products,
  initialProjects,
  initialSites,
  recordedByLabel,
  fetchError,
  readOnly = false,
  embedded = false,
  showForm: showFormProp,
  onShowFormChange,
  onInventoryMutated,
}: InternalConsumptionProps) {
  const supabase = createClient();
  const [showFormInternal, setShowFormInternal] = useState(false);
  const showForm = showFormProp ?? showFormInternal;
  const setShowForm = (next: boolean) => {
    if (!next) {
      setLoading(false);
    }
    if (onShowFormChange) {
      onShowFormChange(next);
    } else {
      setShowFormInternal(next);
    }
  };
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [formError, setFormError] = useState<string | null>(null);

  const formSiteOptions = useMemo(
    () =>
      filterInternalConsumptionSites(
        initialSites,
        form.project_id || null,
      ).sort((left, right) => left.site_name.localeCompare(right.site_name)),
    [form.project_id, initialSites],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setFormError(null);

    try {
    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setFormError(buContext.error);
      return;
    }

    const quantity = Number.parseFloat(form.quantity);
    if (Number.isNaN(quantity) || quantity <= 0) {
      setFormError("Quantity must be greater than zero.");
      return;
    }

    if (!form.product_id) {
      setFormError("Select a finished product.");
      return;
    }

    const product = products.find((item) => item.id === form.product_id);
    if (product && product.current_stock < quantity) {
      setFormError(
        `Only ${formatInventoryQuantity(product.current_stock)} ${product.unit_of_measure} of ${product.product_name} in stock, cannot record use of ${formatInventoryQuantity(quantity)}.`,
      );
      return;
    }

    if (editingEntryId) {
      const editingEntry = entries.find((row) => row.id === editingEntryId);
      if (editingEntry?.business_unit_id != null) {
        try {
          assertCanModifyBusinessUnitRow(
            buContext.allowedUnits,
            editingEntry.business_unit_id,
          );
        } catch (accessError) {
          setFormError(formatBusinessUnitAccessError(accessError));
          return;
        }
      }

      const response = await fetch(
        `/api/inventory/internal-consumption/${editingEntryId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            consumption_date: form.consumption_date,
            product_id: form.product_id,
            quantity,
            reason: nullableText(form.reason),
            notes: nullableText(form.notes),
            site_id: nullableText(form.site_id),
          }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setFormError(payload.error ?? "Unable to save this entry.");
        return;
      }
    } else {
      const response = await fetch("/api/inventory/internal-consumption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: form.product_id,
          quantity,
          consumption_date: form.consumption_date,
          reason: nullableText(form.reason),
          notes: nullableText(form.notes),
          site_id: nullableText(form.site_id),
          recorded_by: recordedByLabel,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setFormError(payload.error ?? "Unable to save this entry.");
        return;
      }
    }

    setEditingEntryId(null);
    setForm(emptyForm);
    setShowForm(false);
    setFormError(null);
    try {
      await onInventoryMutated();
    } catch {
      setError("Saved, but the list could not be refreshed. Try again.");
    }
    } catch (unexpected) {
      setFormError(
        unexpected instanceof Error
          ? unexpected.message
          : "Unable to save this entry.",
      );
    } finally {
      setLoading(false);
    }
  }

  function openEditEntry(entry: InternalConsumptionRecord) {
    setLoading(false);
    setEditingEntryId(entry.id);
    setForm({
      project_id: entry.site?.project_id ?? "",
      site_id: entry.site_id ?? "",
      product_id: entry.product_id,
      quantity: String(entry.quantity),
      consumption_date: entry.consumption_date.slice(0, 10),
      reason: entry.reason ?? "",
      notes: entry.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleDeleteEntry(entry: InternalConsumptionRecord) {
    const productLabel =
      entry.product?.product_name ?? entry.product_id;
    const unitLabel = entry.product?.unit_of_measure ?? "units";
    const quantityLabel = `${formatInventoryQuantity(entry.quantity)} ${unitLabel}`;

    if (
      !(await confirmInternalUseDelete({
        quantityLabel,
        productName: productLabel,
      }))
    ) {
      return;
    }

    setDeletingEntryId(entry.id);
    setError(null);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setError(buContext.error);
      setDeletingEntryId(null);
      return;
    }

    if (entry.business_unit_id != null) {
      try {
        assertCanModifyBusinessUnitRow(
          buContext.allowedUnits,
          entry.business_unit_id,
        );
      } catch (accessError) {
        setError(formatBusinessUnitAccessError(accessError));
        setDeletingEntryId(null);
        return;
      }
    }

    const response = await fetch(
      `/api/inventory/internal-consumption/${entry.id}`,
      { method: "DELETE" },
    );
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Unable to delete this entry.");
      setDeletingEntryId(null);
      return;
    }

    try {
      await onInventoryMutated();
      setError(null);
    } catch {
      setError("Deleted, but the list could not be refreshed. Try again.");
    }
    setDeletingEntryId(null);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "project_id" && value !== current.project_id) {
        const stillValid = filterInternalConsumptionSites(
          initialSites,
          value || null,
        ).some((site) => site.site_code === current.site_id);

        if (!stillValid) {
          next.site_id = "";
        }
      }

      return next;
    });
  }

  const internalUseTable = (
    <ScrollableTable>
      <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>Date</th>
            <th className={scrollableTableThClassName}>Customer</th>
            <th className={scrollableTableThClassName}>Site</th>
            <th className={scrollableTableThClassName}>Product</th>
            <th className={scrollableTableThClassName}>Quantity</th>
            <th className={scrollableTableThClassName}>Reason</th>
            <th className={scrollableTableThClassName}>Recorded By</th>
            {!readOnly ? (
              <th className={scrollableTableActionsThClassName}>Actions</th>
            ) : null}
          </tr>
        </thead>
        <tbody className={scrollableTableBodyClassName}>
          {entries.length === 0 ? (
            <tr>
              <td
                colSpan={readOnly ? 7 : 8}
                className="px-4 py-8 text-center text-sm text-slate-500"
              >
                No internal use recorded yet.
              </td>
            </tr>
          ) : (
            entries.map((entry, index) => (
              <tr key={entry.id} className={getStripedRowClassName(index)}>
                <td className="px-4 py-3 text-slate-900">
                  {entry.consumption_date}
                </td>
                <td className="px-4 py-3 text-slate-900">
                  {getInternalConsumptionClientName(entry)}
                </td>
                <td className="px-4 py-3 text-slate-900">
                  {getInternalConsumptionSiteName(entry)}
                </td>
                <td className="px-4 py-3 font-medium text-[#0f2744]">
                  {entry.product?.product_name ?? entry.product_id}
                </td>
                <td className="px-4 py-3 text-slate-900">
                  {formatInventoryQuantity(entry.quantity)}{" "}
                  {entry.product?.unit_of_measure ?? ""}
                </td>
                <td className="px-4 py-3 text-slate-900">
                  {entry.reason ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-900">
                  {entry.recorded_by ?? "—"}
                </td>
                {!readOnly ? (
                  <td className={scrollableTableActionsTdClassName}>
                    <div className={registerTableActionsInnerClassName}>
                      <button
                        type="button"
                        onClick={() => openEditEntry(entry)}
                        className="rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteEntry(entry)}
                        disabled={deletingEntryId === entry.id}
                        className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingEntryId === entry.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ScrollableTable>
  );

  return (
    <div className={embedded ? "space-y-4" : "space-y-6"}>
      {error && !showForm ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            Record finished product drawn for your business&apos;s own internal
            use (not sold to a customer). Stock is reduced automatically and a
            Non-Cash Direct Operational expense is posted at the product&apos;s
            weighted-average cost from the go-live date forward. You can edit or
            delete entries when the month is still open.
          </p>
          {!readOnly ? (
            <button
              type="button"
              onClick={() => {
                setLoading(false);
                if (showForm) {
                  setEditingEntryId(null);
                  setForm(emptyForm);
                }
                setShowForm(!showForm);
              }}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
            >
              {showForm ? "Cancel" : "Record Internal Use"}
            </button>
          ) : null}
        </div>
      ) : null}

      {showForm && !readOnly ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingEntryId ? "Edit Internal Use" : "Record Internal Use"}
          </h3>
          {formError ? (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError}
            </p>
          ) : null}
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Customer/Contract (optional)
              </label>
              <select
                value={form.project_id}
                onChange={(event) =>
                  updateField("project_id", event.target.value)
                }
                className={inputClassName}
              >
                <option value="">No specific contract</option>
                {initialProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.project_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Site (optional)
              </label>
              <select
                value={form.site_id}
                onChange={(event) => updateField("site_id", event.target.value)}
                className={inputClassName}
              >
                <option value="">
                  {form.project_id
                    ? "Select site (optional)"
                    : "Select site (optional) — filter by contract above"}
                </option>
                {formSiteOptions.map((site) => (
                  <option key={site.site_code} value={site.site_code}>
                    {site.site_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Finished Product
              </label>
              <select
                required
                value={form.product_id}
                onChange={(event) =>
                  updateField("product_id", event.target.value)
                }
                className={inputClassName}
              >
                <option value="">Select product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {formatInternalUseProductOptionLabel(product)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Consumption Date
              </label>
              <input
                type="date"
                required
                value={form.consumption_date}
                onChange={(event) =>
                  updateField("consumption_date", event.target.value)
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Quantity
              </label>
              <input
                type="number"
                min={0.0001}
                step="0.0001"
                required
                value={form.quantity}
                onChange={(event) => updateField("quantity", event.target.value)}
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Reason
              </label>
              <input
                type="text"
                placeholder='e.g. "general cleaning stock"'
                value={form.reason}
                onChange={(event) => updateField("reason", event.target.value)}
                className={inputClassName}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Notes
              </label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(event) => updateField("notes", event.target.value)}
                className={inputClassName}
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving…" : editingEntryId ? "Save Changes" : "Save Entry"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {embedded ? (
        <InventoryCollapsibleHistorySection
          title="Internal Use"
          count={entries.length}
        >
          {internalUseTable}
        </InventoryCollapsibleHistorySection>
      ) : (
        internalUseTable
      )}
    </div>
  );
}
