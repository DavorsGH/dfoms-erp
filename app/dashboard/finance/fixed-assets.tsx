"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { NamedLookup } from "../lookup-types";
import {
  calculateAssetAccumulatedDepreciationAsOf,
  calculateAssetNetBookValueAsOf,
  calculateYearsElapsed,
  formatDate,
  formatGHS,
  formatPercent,
  generateNextAssetId,
  getAssetCalculations,
  getMonthEndForDate,
  isReducingBalanceMethod,
  type FixedAssetEntry,
} from "./fixed-assets-utils";
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

type FixedAssetsProps = {
  initialAssets: FixedAssetEntry[];
  initialAssetCategories: NamedLookup[];
  initialDepreciationMethods: NamedLookup[];
  fetchError: string | null;
};

const emptyForm = {
  asset_id: "",
  asset_name: "",
  asset_category: "",
  purchase_date: "",
  original_cost: "",
  quantity: "",
  useful_life_years: "",
  depreciation_method: "",
  location: "",
  notes: "",
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function FixedAssets({
  initialAssets,
  initialAssetCategories,
  initialDepreciationMethods,
  fetchError,
}: FixedAssetsProps) {
  const supabase = createClient();
  const [assets, setAssets] = useState(initialAssets);
  const [assetCategories, setAssetCategories] = useState(initialAssetCategories);
  const [depreciationMethods, setDepreciationMethods] = useState(
    initialDepreciationMethods,
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
        { data: methods, error: methodsError },
      ] = await Promise.all([
        client
          .from("asset_categories")
          .select("name")
          .order("name", { ascending: true }),
        client
          .from("depreciation_methods")
          .select("name")
          .order("name", { ascending: true }),
      ]);

      const lookupError =
        categoriesError?.message ?? methodsError?.message ?? null;

      if (lookupError) {
        setError(lookupError);
        return;
      }

      setAssetCategories(categories ?? []);
      setDepreciationMethods(methods ?? []);
    }

    loadLookups();
  }, [showForm]);

  async function refreshAssets() {
    const { data, error: refreshError } = await supabase
      .from("fixed_assets")
      .select("*")
      .order("asset_id", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setAssets(data ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      asset_id: generateNextAssetId(assets.map((asset) => asset.asset_id)),
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(asset: FixedAssetEntry) {
    setEditingId(asset.asset_id);
    setForm({
      asset_id: asset.asset_id,
      asset_name: asset.asset_name,
      asset_category: asset.asset_category,
      purchase_date: toDateInputValue(asset.purchase_date),
      original_cost: String(asset.original_cost),
      quantity: String(asset.quantity),
      useful_life_years: String(asset.useful_life_years),
      depreciation_method: asset.depreciation_method,
      location: asset.location,
      notes: asset.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleDelete(assetId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(assetId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("fixed_assets")
      .delete()
      .eq("asset_id", assetId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === assetId) {
      closeForm();
    }

    await refreshAssets();
    setDeletingId(null);
  }

  function getLiveAssetValues(
    originalCost: number,
    quantity: number,
    usefulLifeYears: number,
    purchaseDate: string,
    depreciationMethod: string,
    asOfMonthEnd = getMonthEndForDate(),
  ) {
    const assetInput = {
      original_cost: originalCost,
      quantity,
      useful_life_years: usefulLifeYears,
      purchase_date: purchaseDate,
      depreciation_method: depreciationMethod,
    };
    const referenceDate = new Date(`${asOfMonthEnd}T12:00:00`);
    const { totalCost, annualDepreciation } = getAssetCalculations(
      originalCost,
      quantity,
      usefulLifeYears,
      purchaseDate,
      depreciationMethod,
      referenceDate,
    );
    const accumulatedDepreciation = calculateAssetAccumulatedDepreciationAsOf(
      assetInput,
      asOfMonthEnd,
    );
    const netBookValue = calculateAssetNetBookValueAsOf(
      assetInput,
      asOfMonthEnd,
    );

    return {
      totalCost,
      annualDepreciation,
      accumulatedDepreciation,
      netBookValue,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const originalCost = Number(form.original_cost);
    const quantity = form.quantity.trim() === "" ? 1 : Number(form.quantity);
    const usefulLifeYears = Number(form.useful_life_years);
    const {
      totalCost,
      annualDepreciation,
      accumulatedDepreciation,
      netBookValue,
    } = getLiveAssetValues(
      originalCost,
      quantity,
      usefulLifeYears,
      form.purchase_date,
      form.depreciation_method,
    );

    const payload = {
      asset_id: form.asset_id.trim(),
      asset_name: form.asset_name,
      asset_category: form.asset_category,
      purchase_date: form.purchase_date,
      original_cost: originalCost,
      quantity,
      total_cost: totalCost,
      useful_life_years: usefulLifeYears,
      depreciation_method: form.depreciation_method,
      annual_depreciation: annualDepreciation,
      accumulated_depreciation: accumulatedDepreciation,
      net_book_value: netBookValue,
      location: form.location,
      notes: form.notes || null,
    };

    const { error: saveError } = editingId
      ? await supabase
          .from("fixed_assets")
          .update(payload)
          .eq("asset_id", editingId)
      : await supabase.from("fixed_assets").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshAssets();
    setLoading(false);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const previewQuantity =
    form.quantity.trim() === "" ? 1 : Number(form.quantity) || 1;
  const previewUsefulLife = Number(form.useful_life_years) || 0;
  const previewCalculations =
    form.purchase_date && previewUsefulLife > 0 && form.depreciation_method
      ? getLiveAssetValues(
          Number(form.original_cost) || 0,
          previewQuantity,
          previewUsefulLife,
          form.purchase_date,
          form.depreciation_method,
        )
      : null;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Track fixed assets, depreciation, and net book values.
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
            {editingId ? "Edit Fixed Asset" : "New Fixed Asset"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Asset ID
                </label>
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-[#0f2744]">
                  {form.asset_id}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Asset Name
                </label>
                <input
                  type="text"
                  required
                  value={form.asset_name}
                  onChange={(e) => updateField("asset_name", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Asset Category
                </label>
                <select
                  required
                  value={form.asset_category}
                  onChange={(e) =>
                    updateField("asset_category", e.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select category</option>
                  {assetCategories.map((category) => (
                    <option key={category.name} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Purchase Date
                </label>
                <input
                  type="date"
                  required
                  value={form.purchase_date}
                  onChange={(e) => updateField("purchase_date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Original Cost
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.original_cost}
                  onChange={(e) => updateField("original_cost", e.target.value)}
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
                  Useful Life (Yrs)
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={form.useful_life_years}
                  onChange={(e) =>
                    updateField("useful_life_years", e.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Depreciation Method
                </label>
                <select
                  required
                  value={form.depreciation_method}
                  onChange={(e) =>
                    updateField("depreciation_method", e.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select method</option>
                  {depreciationMethods.map((method) => (
                    <option key={method.name} value={method.name}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Location
                </label>
                <input
                  type="text"
                  required
                  value={form.location}
                  onChange={(e) => updateField("location", e.target.value)}
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

            {previewCalculations && (
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                <p>
                  Calculation:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {isReducingBalanceMethod(form.depreciation_method)
                      ? "Reducing Balance"
                      : "Straight-Line"}
                  </span>
                  <span className="text-slate-500">
                    {" "}
                    ({calculateYearsElapsed(form.purchase_date)} yrs elapsed)
                  </span>
                </p>
                <p>
                  Total Cost:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {formatGHS(previewCalculations.totalCost)}
                  </span>
                </p>
                <p>
                  Annual Depreciation Rate:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {formatPercent(
                      previewUsefulLife > 0 ? 100 / previewUsefulLife : 0,
                    )}
                  </span>
                </p>
                <p>
                  Annual Depreciation:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {formatGHS(previewCalculations.annualDepreciation)}
                  </span>
                </p>
                <p>
                  Accumulated Depreciation:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {formatGHS(previewCalculations.accumulatedDepreciation)}
                  </span>
                </p>
                <p>
                  Net Book Value:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {formatGHS(previewCalculations.netBookValue)}
                  </span>
                </p>
              </div>
            )}

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
                <th className={scrollableTableThClassName}>Asset ID</th>
                <th className={scrollableTableThClassName}>Asset Name</th>
                <th className={scrollableTableThClassName}>Category</th>
                <th className={scrollableTableThClassName}>Purchase Date</th>
                <th className={scrollableTableThClassName}>Original Cost</th>
                <th className={scrollableTableThClassName}>Quantity</th>
                <th className={scrollableTableThClassName}>Total Cost</th>
                <th className={scrollableTableThClassName}>Useful Life (Yrs)</th>
                <th className={scrollableTableThClassName}>Depreciation Method</th>
                <th className={scrollableTableThClassName}>Annual Depreciation</th>
                <th className={scrollableTableThClassName}>
                  Accumulated Depreciation
                </th>
                <th className={scrollableTableThClassName}>Net Book Value</th>
                <th className={scrollableTableThClassName}>Location</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {assets.length === 0 ? (
                <tr>
                  <td
                    colSpan={14}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No fixed assets yet.
                  </td>
                </tr>
              ) : (
                assets.map((asset, index) => {
                  const {
                    totalCost,
                    annualDepreciation,
                    accumulatedDepreciation,
                    netBookValue,
                  } = getLiveAssetValues(
                    asset.original_cost,
                    asset.quantity,
                    asset.useful_life_years,
                    asset.purchase_date,
                    asset.depreciation_method,
                  );

                  return (
                    <tr
                      key={asset.asset_id}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3">{asset.asset_id}</td>
                      <td className="px-4 py-3">{asset.asset_name}</td>
                      <td className="px-4 py-3">{asset.asset_category}</td>
                      <td className="px-4 py-3">
                        {formatDate(asset.purchase_date)}
                      </td>
                      <td className="px-4 py-3">
                        {formatGHS(asset.original_cost)}
                      </td>
                      <td className="px-4 py-3">{asset.quantity}</td>
                      <td className="px-4 py-3">{formatGHS(totalCost)}</td>
                      <td className="px-4 py-3">{asset.useful_life_years}</td>
                      <td className="px-4 py-3">{asset.depreciation_method}</td>
                      <td className="px-4 py-3">
                        {formatGHS(annualDepreciation)}
                      </td>
                      <td className="px-4 py-3">
                        {formatGHS(accumulatedDepreciation)}
                      </td>
                      <td className="px-4 py-3">{formatGHS(netBookValue)}</td>
                      <td className="px-4 py-3">{asset.location}</td>
                      <RegisterRowActions
                        onEdit={() => openEditForm(asset)}
                        onDelete={() => handleDelete(asset.asset_id)}
                        deleting={deletingId === asset.asset_id}
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
