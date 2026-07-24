"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import { getStripedRowClassName } from "../finance/register-row-actions";
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
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "./finished-products-utils";
import {
  filterInternalConsumptionSites,
  getInternalConsumptionClientName,
  getInternalConsumptionSiteName,
  INTERNAL_CONSUMPTION_SELECT,
  normalizeInternalConsumption,
  type InternalConsumptionRecord,
} from "./internal-consumption-utils";

type InternalConsumptionProps = {
  initialEntries: InternalConsumptionRecord[];
  initialProducts: FinishedProductRecord[];
  initialProjects: ContractProjectOption[];
  initialSites: SiteEntry[];
  recordedByLabel: string;
  fetchError: string | null;
  readOnly?: boolean;
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
  initialEntries,
  initialProducts,
  initialProjects,
  initialSites,
  recordedByLabel,
  fetchError,
  readOnly = false,
}: InternalConsumptionProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeInternalConsumption),
  );
  const [products, setProducts] = useState(
    initialProducts.map(normalizeFinishedProduct),
  );
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const formSiteOptions = useMemo(
    () =>
      filterInternalConsumptionSites(
        initialSites,
        form.project_id || null,
      ).sort((left, right) => left.site_name.localeCompare(right.site_name)),
    [form.project_id, initialSites],
  );

  useEffect(() => {
    setEntries(initialEntries.map(normalizeInternalConsumption));
    setProducts(initialProducts.map(normalizeFinishedProduct));
  }, [initialEntries, initialProducts]);

  async function refreshData() {
    const [
      { data: entryRows, error: entryError },
      { data: productRows, error: productError },
    ] = await Promise.all([
      supabase
        .from("internal_consumption")
        .select(INTERNAL_CONSUMPTION_SELECT)
        .order("consumption_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("finished_products")
        .select(FINISHED_PRODUCT_SELECT)
        .order("product_name", { ascending: true }),
    ]);

    if (entryError || productError) {
      setError(entryError?.message ?? productError?.message ?? "Refresh failed.");
      return;
    }

    setEntries(
      (((entryRows as unknown) as InternalConsumptionRecord[] | null) ?? []).map(
        (row) => normalizeInternalConsumption(row),
      ),
    );
    setProducts(
      ((productRows as FinishedProductRecord[] | null) ?? []).map((row) =>
        normalizeFinishedProduct(row),
      ),
    );
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const quantity = Number.parseFloat(form.quantity);
    if (Number.isNaN(quantity) || quantity <= 0) {
      setError("Quantity must be greater than zero.");
      setLoading(false);
      return;
    }

    if (!form.product_id) {
      setError("Select a finished product.");
      setLoading(false);
      return;
    }

    const product = products.find((item) => item.id === form.product_id);
    if (product && product.current_stock < quantity) {
      setError(
        `Only ${formatInventoryQuantity(product.current_stock)} ${product.unit_of_measure} of ${product.product_name} in stock, cannot record use of ${formatInventoryQuantity(quantity)}.`,
      );
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase
      .from("internal_consumption")
      .insert({
        product_id: form.product_id,
        quantity,
        consumption_date: form.consumption_date,
        reason: nullableText(form.reason),
        notes: nullableText(form.notes),
        recorded_by: recordedByLabel,
        site_id: nullableText(form.site_id),
      });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setForm(emptyForm);
    setShowForm(false);
    await refreshData();
    setLoading(false);
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

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          Record finished product drawn for Davors&apos; own internal cleaning
          use. Entries are append-only and reduce finished product stock
          automatically — nothing posts to Finance in this phase.
        </p>
        {!readOnly ? (
        <button
          type="button"
          onClick={() => setShowForm((current) => !current)}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Record Internal Use"}
        </button>
        ) : null}
      </div>

      {showForm && !readOnly ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            New Internal Consumption
          </h3>
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
                    {product.product_code} — {product.product_name} (
                    {formatInventoryQuantity(product.current_stock)}{" "}
                    {product.unit_of_measure} in stock)
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
                {loading ? "Saving…" : "Save Entry"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

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
            </tr>
          </thead>
          <tbody className={scrollableTableBodyClassName}>
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No internal consumption recorded yet.
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
