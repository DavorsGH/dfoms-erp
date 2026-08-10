"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
} from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import FilteredListCount from "@/app/dashboard/filtered-list-count";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import ProductsBulkImport from "./products-bulk-import";
import {
  BILLING_CYCLE_OPTIONS,
  buildCrmProductSavePayload,
  buildPlatformUnitActivationCatalogEntry,
  CRM_PRODUCT_SELECT,
  EMPTY_CRM_PRODUCT_FORM,
  ERP_SUITE_CATEGORY,
  formatActiveStatus,
  formatBillingCycle,
  formatCatalogUnitPrice,
  formatProductType,
  getCatalogManagedLabel,
  getUniqueProductCategories,
  isCatalogProductEditable,
  crmProductEntryToForm,
  PLATFORM_BILLING_CATEGORY,
  PRODUCT_TYPE_OPTIONS,
  type CrmProductEntry,
  type CrmProductFormState,
} from "./products-utils";

type ProductsProps = {
  initialProducts: CrmProductEntry[];
  platformUnitActivationPriceGhs: number;
  showPlatformBillingCatalogEntry: boolean;
  fetchError: string | null;
};

const sectionActionLinkClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

export default function Products({
  initialProducts,
  platformUnitActivationPriceGhs,
  showPlatformBillingCatalogEntry,
  fetchError,
}: ProductsProps) {
  const supabase = createClient();
  const [products, setProducts] = useState(initialProducts);
  const [filterCategory, setFilterCategory] = useState(ERP_SUITE_CATEGORY);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState<CrmProductFormState>(EMPTY_CRM_PRODUCT_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setProducts(initialProducts);
  }, [initialProducts]);

  const catalogProducts = useMemo(() => {
    const rows = showPlatformBillingCatalogEntry
      ? [
          ...products,
          buildPlatformUnitActivationCatalogEntry(platformUnitActivationPriceGhs),
        ]
      : products;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [platformUnitActivationPriceGhs, products, showPlatformBillingCatalogEntry]);

  const categoryOptions = useMemo(() => {
    const unique = new Set(getUniqueProductCategories(catalogProducts));
    unique.add(ERP_SUITE_CATEGORY);
    if (showPlatformBillingCatalogEntry) {
      unique.add(PLATFORM_BILLING_CATEGORY);
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [catalogProducts, showPlatformBillingCatalogEntry]);

  const filteredProducts = useMemo(() => {
    return catalogProducts.filter((product) => {
      if (!filterCategory) {
        return true;
      }

      return (product.category ?? "") === filterCategory;
    });
  }, [catalogProducts, filterCategory]);

  const editableProducts = useMemo(
    () => products.filter(isCatalogProductEditable),
    [products],
  );

  async function refreshProducts() {
    const { data, error: refreshError } = await supabase
      .from("crm_products")
      .select(CRM_PRODUCT_SELECT)
      .order("name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setProducts((data as CrmProductEntry[] | null) ?? []);
    setError(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_CRM_PRODUCT_FORM);
  }

  function openAddForm() {
    setShowBulkImport(false);
    setEditingId(null);
    setForm(EMPTY_CRM_PRODUCT_FORM);
    setShowForm(true);
  }

  function openEditForm(product: CrmProductEntry) {
    if (!isCatalogProductEditable(product)) {
      return;
    }

    setShowBulkImport(false);
    setEditingId(product.id);
    setForm(crmProductEntryToForm(product));
    setShowForm(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const payload = buildCrmProductSavePayload(form);
    if (!payload.name) {
      setError("Product name is required.");
      setLoading(false);
      return;
    }

    if (editingId) {
      const { error: saveError } = await supabase
        .from("crm_products")
        .update(payload)
        .eq("id", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const { tenantId, error: tenantError } =
        await resolveSessionTenantId(supabase);

      if (tenantError || !tenantId) {
        setError(tenantError ?? "Unable to resolve workspace for this session.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase.from("crm_products").insert({
        ...payload,
        tenant_id: tenantId,
      });

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    }

    closeForm();
    await refreshProducts();
    setLoading(false);
  }

  async function handleDelete(product: CrmProductEntry) {
    if (!isCatalogProductEditable(product)) {
      return;
    }

    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(product.id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("crm_products")
      .delete()
      .eq("id", product.id);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === product.id) {
      closeForm();
    }

    await refreshProducts();
    setDeletingId(null);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Filter by Category
          </label>
          <select
            value={filterCategory}
            onChange={(event) => setFilterCategory(event.target.value)}
            className={inputClassName}
          >
            <option value="">All categories</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setShowForm(false);
              setShowBulkImport((current) => !current);
            }}
            className={sectionActionLinkClassName}
          >
            {showBulkImport ? "Cancel Import" : "Bulk Import"}
          </button>
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm())}
            className={primaryButtonClassName}
          >
            {showForm ? "Cancel" : "Add Product"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {showBulkImport ? (
        <ProductsBulkImport
          existingProducts={editableProducts}
          onClose={() => setShowBulkImport(false)}
          onImported={refreshProducts}
        />
      ) : null}

      {showForm ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit Product" : "Add Product"}
          </h3>
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Name
              </label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Product Type
              </label>
              <select
                value={form.product_type}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    product_type: event.target.value,
                  }))
                }
                className={inputClassName}
              >
                {PRODUCT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Category
              </label>
              <input
                type="text"
                value={form.category}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Unit Price (GHS)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.unit_price}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    unit_price: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Billing Cycle
              </label>
              <select
                value={form.billing_cycle}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    billing_cycle: event.target.value,
                  }))
                }
                className={inputClassName}
              >
                {BILLING_CYCLE_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <input
                id="product-is-active"
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
              <label htmlFor="product-is-active" className="text-sm text-slate-700">
                Active
              </label>
            </div>
            <div className="flex gap-3 md:col-span-2">
              <button type="submit" disabled={loading} className={primaryButtonClassName}>
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Product"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={loading}
                className={sectionActionLinkClassName}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <FilteredListCount
        filteredCount={filteredProducts.length}
        totalCount={catalogProducts.length}
        itemSingular="product"
        hasActiveFilters={Boolean(filterCategory)}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Name</th>
              <th className={scrollableTableThClassName}>Product Type</th>
              <th className={scrollableTableThClassName}>Category</th>
              <th className={scrollableTableThClassName}>Unit Price</th>
              <th className={scrollableTableThClassName}>Billing Cycle</th>
              <th className={scrollableTableThClassName}>Active</th>
              <th className={scrollableTableThClassName}>Source</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredProducts.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No products match the selected category filter.
                </td>
              </tr>
            ) : (
              filteredProducts.map((product, index) => {
                const editable = isCatalogProductEditable(product);

                return (
                  <tr key={product.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {product.name}
                    </td>
                    <td className="px-4 py-3">
                      {formatProductType(product.product_type)}
                    </td>
                    <td className="px-4 py-3">{product.category ?? "—"}</td>
                    <td className="px-4 py-3">
                      {formatCatalogUnitPrice(product)}
                    </td>
                    <td className="px-4 py-3">
                      {formatBillingCycle(product.billing_cycle)}
                    </td>
                    <td className="px-4 py-3">
                      {formatActiveStatus(product.is_active)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-slate-500">
                        {getCatalogManagedLabel(product) ?? "Catalog"}
                      </span>
                    </td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(product)}
                      onDelete={
                        editable ? () => void handleDelete(product) : undefined
                      }
                      deleting={deletingId === product.id}
                      disableEdit={!editable || loading}
                      disableDelete={!editable || loading}
                      deleteDisabledTitle={
                        editable
                          ? undefined
                          : "Managed catalog entries cannot be deleted here."
                      }
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
