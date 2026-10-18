"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAlert } from "@/components/feedback/feedback-context";
import { createClient } from "@/utils/supabase/client";
import {
  SALES_CRM_ALERT_TITLE,
  clientFacingSalesCrmError,
} from "@/lib/crm/sales-crm-notifications";
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
import { useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import {
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  loadWriteBusinessUnitContext,
  resolveWriteBusinessUnitId,
} from "@/utils/business-unit-access";
import ProductsBulkImport from "./products-bulk-import";
import {
  BILLING_CYCLE_OPTIONS,
  buildCrmProductSavePayload,
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
  PRODUCT_TYPE_OPTIONS,
  type CrmProductEntry,
  type CrmProductFormState,
} from "./products-utils";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";

type ProductsProps = {
  initialProducts: CrmProductEntry[];
  fetchError: string | null;
};

const sectionActionLinkClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

export default function Products({
  initialProducts,
  fetchError,
}: ProductsProps) {
  const supabase = createClient();
  const { alertError } = useAlert();
  const productFormRef = useRef<HTMLFormElement>(null);
  const buReadScope = useBusinessUnitReadScope();

  function showActionError(message: string) {
    void alertError(clientFacingSalesCrmError(message), {
      title: SALES_CRM_ALERT_TITLE,
    });
  }

  useEffect(() => {
    if (fetchError) {
      void alertError(clientFacingSalesCrmError(fetchError, "Could not load."), {
        title: SALES_CRM_ALERT_TITLE,
      });
    }
  }, [fetchError, alertError]);
  const [products, setProducts] = useState(initialProducts);
  const [filterCategory, setFilterCategory] = useState(ERP_SUITE_CATEGORY);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState<CrmProductFormState>(EMPTY_CRM_PRODUCT_FORM);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setProducts(initialProducts);
  }, [initialProducts]);

  const catalogProducts = useMemo(() => {
    return [...products].sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const categoryOptions = useMemo(
    () => getUniqueProductCategories(catalogProducts),
    [catalogProducts],
  );

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
    const { data, error: refreshError } = await applyBusinessUnitScope(
      supabase.from("crm_products").select(CRM_PRODUCT_SELECT),
      buReadScope,
    ).order("name", { ascending: true });

    if (refreshError) {
      showActionError(refreshError.message);
      return;
    }

    setProducts((data as CrmProductEntry[] | null) ?? []);
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
    if (!productFormRef.current?.reportValidity()) {
      return;
    }

    setLoading(true);

    const payload = buildCrmProductSavePayload(form);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      showActionError(buContext.error);
      setLoading(false);
      return;
    }

    if (editingId) {
      const existing = products.find((product) => product.id === editingId);
      try {
        assertCanModifyBusinessUnitRow(
          buContext.allowedUnits,
          existing?.business_unit_id,
        );
      } catch (accessError) {
        showActionError(formatBusinessUnitAccessError(accessError));
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase
        .from("crm_products")
        .update(payload)
        .eq("id", editingId);

      if (saveError) {
        showActionError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const { tenantId, error: tenantError } =
        await resolveSessionTenantId(supabase);

      if (tenantError || !tenantId) {
        showActionError(
          tenantError ?? "Unable to resolve workspace for this session.",
        );
        setLoading(false);
        return;
      }

      let businessUnitId: string | null;
      try {
        businessUnitId = resolveWriteBusinessUnitId({
          allowedUnits: buContext.allowedUnits,
        });
      } catch (accessError) {
        showActionError(formatBusinessUnitAccessError(accessError));
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase.from("crm_products").insert({
        ...payload,
        tenant_id: tenantId,
        business_unit_id: businessUnitId,
      });

      if (saveError) {
        showActionError(saveError.message);
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

    if (!(await confirmDeleteEntry())) {
      return;
    }

    setDeletingId(product.id);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      showActionError(buContext.error);
      setDeletingId(null);
      return;
    }

    try {
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        product.business_unit_id,
      );
    } catch (accessError) {
      showActionError(formatBusinessUnitAccessError(accessError));
      setDeletingId(null);
      return;
    }

    const { error: deleteError } = await supabase
      .from("crm_products")
      .delete()
      .eq("id", product.id);

    if (deleteError) {
      showActionError(deleteError.message);
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
          <form
            ref={productFormRef}
            onSubmit={handleSubmit}
            className="grid gap-4 md:grid-cols-2"
          >
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
