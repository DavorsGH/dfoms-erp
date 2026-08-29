"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { mapApproverRows } from "../approver-utils";
import type { Approver, NamedLookup } from "../lookup-types";
import {
  calculateAssetAccumulatedDepreciationAsOf,
  calculateAssetNetBookValueAsOf,
  calculateYearsElapsed,
  formatDate,
  formatGHS,
  formatPercent,
  getAssetCalculations,
  getMonthEndForDate,
  isReducingBalanceMethod,
  type FixedAssetEntry,
} from "./fixed-assets-utils";
import { isCreditPaymentMethod } from "../inventory/inventory-balance-sheet-utils";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import { allocateAssetId } from "./asset-id-api";
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
import FilteredListCount from "../filtered-list-count";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import {
  computePurchaseTaxAmounts,
  computeWhtAmount,
  resolveDefaultWhtRate,
  roundTaxAmount,
  roundTaxRate,
  selectTaxRateOptions,
  type TaxRateCatalogEntry,
  type TaxSettings,
} from "./tax-utils";
import {
  deleteTaxLedgerEntriesForSource,
  syncPurchaseTaxLedger,
} from "./tax-ledger-sync";
import type { SupplierRow } from "@/utils/suppliers-types";
import { SUPPLIER_SELECT } from "@/utils/suppliers-types";
import {
  inferVendorSelectState,
  resolveVendorNameFromSelect,
  VENDOR_OTHER_VALUE,
} from "./vendor-select-utils";
import { useStampBusinessUnitId } from "@/app/dashboard/business-unit-view-context";

type FixedAssetsProps = {
  initialAssets: FixedAssetEntry[];
  initialAssetCategories: NamedLookup[];
  initialDepreciationMethods: NamedLookup[];
  initialPaymentMethods: NamedLookup[];
  initialApprovers: Approver[];
  initialSuppliers: SupplierRow[];
  taxSettings: TaxSettings | null;
  taxRateCatalog: TaxRateCatalogEntry[];
  fetchError: string | null;
  /** Create-only stamp; null = All Businesses. */
  activeBusinessUnitId?: string | null;
};

type FixedAssetFormState = {
  asset_id: string;
  asset_name: string;
  asset_category: string;
  purchase_date: string;
  original_cost: string;
  quantity: string;
  useful_life_years: string;
  depreciation_method: string;
  location: string;
  notes: string;
  payment_method: string;
  vendor_select: string;
  vendor_other: string;
  approved_by: string;
  has_wht_vat: boolean;
  wht_rate: string;
  wht_amount: string;
  input_vat_amount: string;
};

const emptyForm: FixedAssetFormState = {
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
  payment_method: "Cash",
  vendor_select: "",
  vendor_other: "",
  approved_by: "",
  has_wht_vat: false,
  wht_rate: "0",
  wht_amount: "",
  input_vat_amount: "",
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function formatRateValue(rate: number): string {
  return String(roundTaxRate(rate));
}

function formatWhtAmount(gross: string, ratePct: string): string {
  const rate = Number(ratePct) || 0;
  if (rate <= 0) {
    return "";
  }

  return String(computeWhtAmount(Number(gross) || 0, rate));
}

export default function FixedAssets({
  initialAssets,
  initialAssetCategories,
  initialDepreciationMethods,
  initialPaymentMethods,
  initialApprovers,
  initialSuppliers,
  taxSettings,
  taxRateCatalog,
  fetchError,
  activeBusinessUnitId = null,
}: FixedAssetsProps) {
  const supabase = createClient();
  const stampBusinessUnit = useStampBusinessUnitId();
  const [assets, setAssets] = useState(initialAssets);
  const [assetCategories, setAssetCategories] = useState(initialAssetCategories);
  const [depreciationMethods, setDepreciationMethods] = useState(
    initialDepreciationMethods,
  );
  const [paymentMethods, setPaymentMethods] = useState(initialPaymentMethods);
  const [approvers, setApprovers] = useState(initialApprovers);
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [whtAmountEdited, setWhtAmountEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const defaultWhtRate = formatRateValue(resolveDefaultWhtRate(taxSettings));
  const whtRateOptions = useMemo(() => {
    const options = new Map<string, string>([["0", "No WHT (0%)"]]);

    for (const rate of selectTaxRateOptions(taxRateCatalog, "wht")) {
      options.set(formatRateValue(rate.rate_pct), rate.label);
    }

    for (const rate of [defaultWhtRate, form.wht_rate]) {
      if (rate && rate !== "0" && !options.has(rate)) {
        options.set(rate, `WHT ${rate}%`);
      }
    }

    return [...options.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => Number(left.value) - Number(right.value));
  }, [taxRateCatalog, defaultWhtRate, form.wht_rate]);

  useEffect(() => {
    if (!showForm) {
      return;
    }

    const client = createClient();

    async function loadLookups() {
      const { tenantId } = await resolveSessionTenantId(client);
      const [
        { data: categories, error: categoriesError },
        { data: methods, error: methodsError },
        { data: payments, error: paymentsError },
        { data: approverRows, error: approversError },
        suppliersResult,
      ] = await Promise.all([
        client
          .from("asset_categories")
          .select("name")
          .order("name", { ascending: true }),
        client
          .from("depreciation_methods")
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
        tenantId
          ? client
              .from("suppliers")
              .select(SUPPLIER_SELECT)
              .eq("tenant_id", tenantId)
              .eq("is_active", true)
              .order("name", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);

      const suppliersError = suppliersResult.error?.message ?? null;

      const lookupError =
        categoriesError?.message ??
        methodsError?.message ??
        paymentsError?.message ??
        approversError?.message ??
        suppliersError ??
        null;

      if (lookupError) {
        setError(lookupError);
        return;
      }

      setAssetCategories(categories ?? []);
      setDepreciationMethods(methods ?? []);
      setPaymentMethods(payments ?? []);
      setApprovers(mapApproverRows(approverRows ?? []) as Approver[]);
      setSuppliers((suppliersResult.data as SupplierRow[] | null) ?? []);
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
    setWhtAmountEdited(false);
    setForm({ ...emptyForm });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setWhtAmountEdited(false);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(asset: FixedAssetEntry) {
    setEditingId(asset.asset_id);
    setWhtAmountEdited(false);
    const vendorState = inferVendorSelectState(asset.vendor_name ?? "", suppliers);
    const hasTax =
      (asset.wht_rate ?? 0) > 0 ||
      (asset.wht_amount ?? 0) > 0 ||
      (asset.input_vat_amount ?? 0) > 0;
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
      payment_method: asset.payment_method ?? "Cash",
      vendor_select: vendorState.vendorSelect,
      vendor_other: vendorState.vendorOther,
      approved_by: asset.approved_by ?? "",
      has_wht_vat: hasTax,
      wht_rate: hasTax ? formatRateValue(asset.wht_rate ?? 0) : "0",
      wht_amount: asset.wht_amount == null ? "" : String(asset.wht_amount),
      input_vat_amount:
        asset.input_vat_amount == null || asset.input_vat_amount === 0
          ? ""
          : String(asset.input_vat_amount),
    });
    setShowForm(true);
  }

  async function handleDelete(assetId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(assetId);
    setError(null);

    const existing = assets.find((asset) => asset.asset_id === assetId);
    if (existing?.accounts_payable_id) {
      const { error: reverseError } = await supabase.rpc(
        "reverse_fixed_asset_payable",
        { p_payable_id: existing.accounts_payable_id },
      );
      if (reverseError) {
        setError(reverseError.message);
        setDeletingId(null);
        return;
      }
    }

    const { error: deleteError } = await supabase
      .from("fixed_assets")
      .delete()
      .eq("asset_id", assetId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    const { error: ledgerError } = await deleteTaxLedgerEntriesForSource(
      supabase,
      "fixed_asset",
      assetId,
    );

    if (ledgerError) {
      setError(
        `Asset deleted, but its tax ledger entries could not be removed: ${ledgerError}`,
      );
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

    if (!editingId && !stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      setLoading(false);
      return;
    }

    const originalCost = Number(form.original_cost);
    const quantity = form.quantity.trim() === "" ? 1 : Number(form.quantity);
    const usefulLifeYears = Number(form.useful_life_years);
    const { totalCost } = getLiveAssetValues(
      originalCost,
      quantity,
      usefulLifeYears,
      form.purchase_date,
      form.depreciation_method,
    );

    const paymentMethod = form.payment_method.trim() || "Cash";
    const vendorName = resolveVendorNameFromSelect(
      form.vendor_select,
      form.vendor_other,
      suppliers,
    );
    if (!vendorName) {
      setError("Vendor is required.");
      setLoading(false);
      return;
    }
    if (form.vendor_select === VENDOR_OTHER_VALUE && !form.vendor_other.trim()) {
      setError("Enter the one-time vendor name.");
      setLoading(false);
      return;
    }
    if (isCreditPaymentMethod(paymentMethod) && !vendorName) {
      setError("Vendor name is required for credit / on-account purchases.");
      setLoading(false);
      return;
    }

    const whtRate = form.has_wht_vat ? Number(form.wht_rate) || 0 : 0;
    const whtAmount = form.has_wht_vat
      ? Math.max(0, roundTaxAmount(Number(form.wht_amount) || 0))
      : 0;
    const inputVatAmount = form.has_wht_vat
      ? Math.max(0, roundTaxAmount(Number(form.input_vat_amount) || 0))
      : 0;
    const purchaseTax = computePurchaseTaxAmounts({
      grossBeforeWht: totalCost,
      whtRatePct: whtRate,
      whtAmount,
      inputVatAmount,
    });

    // Capitalize / depreciate ex reclaimable input VAT (net_of_tax).
    const capitalizedCost = purchaseTax.netOfTaxAmount;
    const capitalizedLive = getLiveAssetValues(
      capitalizedCost,
      1,
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
      annual_depreciation: capitalizedLive.annualDepreciation,
      accumulated_depreciation: capitalizedLive.accumulatedDepreciation,
      net_book_value: capitalizedLive.netBookValue,
      location: form.location,
      notes: form.notes || null,
      payment_method: paymentMethod,
      vendor_name: vendorName,
      approved_by: form.approved_by || null,
      gross_before_wht: purchaseTax.grossBeforeWht,
      wht_rate: whtRate > 0 ? whtRate : null,
      wht_amount: purchaseTax.whtAmount,
      input_vat_amount: purchaseTax.inputVatAmount,
      net_of_tax_amount: purchaseTax.netOfTaxAmount,
    };

    const { tenantId, error: tenantError } =
      await resolveSessionTenantId(supabase);
    if (tenantError || !tenantId) {
      setError(tenantError ?? "Unable to resolve workspace.");
      setLoading(false);
      return;
    }

    const existingAsset = editingId
      ? assets.find((asset) => asset.asset_id === editingId)
      : null;
    let savedAssetId = editingId;

    if (editingId) {
      const { error: saveError } = await supabase
        .from("fixed_assets")
        .update({
          asset_name: payload.asset_name,
          asset_category: payload.asset_category,
          purchase_date: payload.purchase_date,
          original_cost: payload.original_cost,
          quantity: payload.quantity,
          total_cost: payload.total_cost,
          useful_life_years: payload.useful_life_years,
          depreciation_method: payload.depreciation_method,
          annual_depreciation: payload.annual_depreciation,
          accumulated_depreciation: payload.accumulated_depreciation,
          net_book_value: payload.net_book_value,
          location: payload.location,
          notes: payload.notes,
          payment_method: payload.payment_method,
          vendor_name: payload.vendor_name,
          approved_by: payload.approved_by,
          gross_before_wht: payload.gross_before_wht,
          wht_rate: payload.wht_rate,
          wht_amount: payload.wht_amount,
          input_vat_amount: payload.input_vat_amount,
          net_of_tax_amount: payload.net_of_tax_amount,
        })
        .eq("asset_id", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateAssetId(supabase);
      if (allocated.error || !allocated.assetId) {
        setError(allocated.error ?? "Unable to allocate asset ID.");
        setLoading(false);
        return;
      }

      savedAssetId = allocated.assetId;

      const { error: saveError } = await supabase.from("fixed_assets").insert({
        ...payload,
        asset_id: allocated.assetId,
        business_unit_id: stampBusinessUnit.ok
          ? stampBusinessUnit.businessUnitId
          : null,
      });

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }

      requestTenantAdminDirectorNotification({
        title: "New fixed asset recorded",
        detail: payload.asset_name.trim() || allocated.assetId,
        actionUrl: "/dashboard/finance/fixed-assets",
      });
    }

    const { data: payableId, error: syncError } = await supabase.rpc(
      "sync_fixed_asset_payable",
      {
        p_tenant_id: tenantId,
        p_asset_id: savedAssetId,
        p_vendor_name: payload.vendor_name,
        p_purchase_date: payload.purchase_date,
        p_payment_method: payload.payment_method,
        p_total_cost: payload.total_cost,
        p_asset_name: payload.asset_name,
        p_existing_payable_id: existingAsset?.accounts_payable_id ?? null,
      },
    );

    if (syncError) {
      setError(`Asset saved but linked payable sync failed: ${syncError.message}`);
      setLoading(false);
      return;
    }

    if (savedAssetId) {
      const { error: linkError } = await supabase
        .from("fixed_assets")
        .update({ accounts_payable_id: payableId ?? null })
        .eq("asset_id", savedAssetId);

      if (linkError) {
        setError(`Asset saved but payable link update failed: ${linkError.message}`);
        setLoading(false);
        return;
      }
    }

    const { error: ledgerError } = await syncPurchaseTaxLedger(supabase, {
      sourceType: "fixed_asset",
      sourceId: savedAssetId as string,
      entryDate: form.purchase_date,
      grossBeforeWht: purchaseTax.grossBeforeWht,
      whtRatePct: whtRate > 0 ? whtRate : null,
      whtAmount: purchaseTax.whtAmount,
      inputTaxComponent: purchaseTax.inputTaxComponent,
      inputTaxRatePct: null,
      inputVatAmount: purchaseTax.inputVatAmount,
      counterpartyName: vendorName || null,
      notes: payload.asset_name.trim() || null,
    });

    closeForm();
    await refreshAssets();

    if (ledgerError) {
      setError(
        `Asset saved, but the tax ledger could not be updated: ${ledgerError}`,
      );
    }

    setLoading(false);
  }

  function updateField<K extends keyof FixedAssetFormState>(
    field: K,
    value: FixedAssetFormState[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function currentGrossString(next?: Partial<FixedAssetFormState>): string {
    const originalCost = Number(next?.original_cost ?? form.original_cost) || 0;
    const quantityRaw = (next?.quantity ?? form.quantity).trim();
    const quantity = quantityRaw === "" ? 1 : Number(quantityRaw) || 1;
    return String(originalCost * quantity);
  }

  function toggleHasWhtVat(checked: boolean) {
    setWhtAmountEdited(false);
    setForm((current) => ({
      ...current,
      has_wht_vat: checked,
      wht_rate: checked ? defaultWhtRate : "0",
      wht_amount: checked
        ? formatWhtAmount(currentGrossString(current), defaultWhtRate)
        : "",
      input_vat_amount: checked ? current.input_vat_amount : "",
    }));
  }

  function updateOriginalCost(value: string) {
    setForm((current) => {
      const next = { ...current, original_cost: value };
      const gross = currentGrossString(next);
      return {
        ...next,
        wht_amount: whtAmountEdited
          ? current.wht_amount
          : formatWhtAmount(gross, current.wht_rate),
      };
    });
  }

  function updateQuantity(value: string) {
    setForm((current) => {
      const next = { ...current, quantity: value };
      const gross = currentGrossString(next);
      return {
        ...next,
        wht_amount: whtAmountEdited
          ? current.wht_amount
          : formatWhtAmount(gross, current.wht_rate),
      };
    });
  }

  function updateWhtRate(value: string) {
    setWhtAmountEdited(false);
    setForm((current) => ({
      ...current,
      wht_rate: value,
      wht_amount: formatWhtAmount(currentGrossString(current), value),
    }));
  }

  function updateWhtAmount(value: string) {
    setWhtAmountEdited(true);
    updateField("wht_amount", value);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Track fixed assets, depreciation, and net book values.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/bulk-import?type=fixed_asset"
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            Bulk Import
          </Link>
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showForm ? "Cancel" : "Add Entry"}
          </button>
        </div>
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
              {editingId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Asset ID
                  </label>
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-[#0f2744]">
                    {form.asset_id}
                  </p>
                </div>
              ) : null}
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
                  onChange={(e) => updateOriginalCost(e.target.value)}
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
                  onChange={(e) => updateQuantity(e.target.value)}
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
                  Payment Method
                </label>
                <select
                  required
                  value={form.payment_method}
                  onChange={(e) =>
                    updateField("payment_method", e.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select method</option>
                  {(paymentMethods.length > 0
                    ? paymentMethods
                    : [{ name: "Cash" }, { name: "Supplier Credit" }]
                  ).map((method) => (
                    <option key={method.name} value={method.name}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Vendor
                </label>
                <select
                  required
                  value={form.vendor_select}
                  onChange={(e) => updateField("vendor_select", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select vendor</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                  <option value={VENDOR_OTHER_VALUE}>Other (one-time vendor)</option>
                </select>
              </div>
              {form.vendor_select === VENDOR_OTHER_VALUE ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    One-time vendor name
                  </label>
                  <input
                    type="text"
                    required
                    value={form.vendor_other}
                    onChange={(e) => updateField("vendor_other", e.target.value)}
                    className={inputClassName}
                  />
                </div>
              ) : null}
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
              <div className="md:col-span-2 xl:col-span-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.has_wht_vat}
                    onChange={(e) => toggleHasWhtVat(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                  />
                  This purchase has WHT/VAT
                </label>
              </div>
              {form.has_wht_vat ? (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      WHT Rate
                    </label>
                    <select
                      value={form.wht_rate}
                      onChange={(e) => updateWhtRate(e.target.value)}
                      className={inputClassName}
                    >
                      {whtRateOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      WHT Amount
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.wht_amount}
                      onChange={(e) => updateWhtAmount(e.target.value)}
                      className={inputClassName}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Auto-calculated from Total Cost × rate. Edit to match the
                      withholding certificate.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Input VAT Amount
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.input_vat_amount}
                      onChange={(e) =>
                        updateField("input_vat_amount", e.target.value)
                      }
                      className={inputClassName}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Optional — VAT/NHIL/GETFund on this purchase (reclaimable
                      input credit).
                    </p>
                  </div>
                </>
              ) : null}
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

      <FilteredListCount
        filteredCount={assets.length}
        totalCount={assets.length}
        itemSingular="asset"
      />

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
