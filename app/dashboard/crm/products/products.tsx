"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
} from "../../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../scrollable-table";
import { inputClassName } from "../../hr-payroll/hr-register-utils";
import { nullableText } from "../../operations/operations-register-utils";
import {
  BILLING_CYCLE_OPTIONS,
  CRM_PRODUCT_SELECT,
  DEFAULT_PRODUCT_TYPE,
  ERP_SUITE_CATEGORY,
  formatActiveStatus,
  formatBillingCycle,
  formatProductPrice,
  formatProductType,
  getUniqueProductCategories,
  PRODUCT_TYPE_OPTIONS,
  type CrmProductEntry,
} from "./products-utils";
import ProductsBulkImport from "./products-bulk-import";

type ProductsProps = {
  initialProducts: CrmProductEntry[];
  fetchError: string | null;
};

type ProductFormState = {
  name: string;
  product_type: string;
  category: string;
  unit_price: string;
  billing_cycle: string;
  is_active: boolean;
};

const emptyForm = (): ProductFormState => ({
  name: "",
  product_type: DEFAULT_PRODUCT_TYPE,
  category: ERP_SUITE_CATEGORY,
  unit_price: "",
  billing_cycle: "",
  is_active: true,
});

export default function Products({
  initialProducts,
  fetchError,
}: ProductsProps) {
  const supabase = createClient();
  const [products, setProducts] = useState(initialProducts);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormState>(emptyForm());
  const [loading, setLoading] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [filterCategory, setFilterCategory] = useState(ERP_SUITE_CATEGORY);

  useEffect(() => {
    setProducts(initialProducts);
  }, [initialProducts]);

  const categoryOptions = useMemo(() => {
    const unique = new Set(getUniqueProductCategories(products));
    unique.add(ERP_SUITE_CATEGORY);
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      if (!filterCategory) {
        return true;
      }

      return (product.category ?? "") === filterCategory;
    });
  }, [filterCategory, products]);

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

  function openAddForm() {
    setShowBulkImport(false);
    setEditingId(null);
    setForm({
      ...emptyForm(),
      category: filterCategory || ERP_SUITE_CATEGORY,
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(false);
  }

  function openBulkImport() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
    setShowBulkImport(true);
  }

  function closeBulkImport() {
    setShowBulkImport(false);
  }

  function openEditForm(product: CrmProductEntry) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      product_type: product.product_type ?? DEFAULT_PRODUCT_TYPE,
      category: product.category ?? "",
      unit_price:
        product.unit_price === null || product.unit_price === undefined
          ? ""
          : String(product.unit_price),
      billing_cycle: product.billing_cycle ?? "",
      is_active: product.is_active ?? true,
    });
    setShowForm(true);
  }

  function updateField<K extends keyof ProductFormState>(
    field: K,
    value: ProductFormState[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleDelete(productId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(productId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("crm_products")
      .delete()
      .eq("id", productId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === productId) {
      closeForm();
    }

    await refreshProducts();
    setDeletingId(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const unitPrice = Number(form.unit_price);
    if (!Number.isFinite(unitPrice)) {
      setError("Unit price must be a valid number.");
      setLoading(false);
      return;
    }

    const payload = {
      name: form.name.trim(),
      product_type: nullableText(form.product_type) ?? DEFAULT_PRODUCT_TYPE,
      category: nullableText(form.category),
      unit_price: unitPrice,
      billing_cycle: nullableText(form.billing_cycle),
      is_active: form.is_active,
    };

    const { error: saveError } = editingId
      ? await supabase.from("crm_products").update(payload).eq("id", editingId)
      : await supabase.from("crm_products").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshProducts();
    setLoading(false);
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => (showBulkImport ? closeBulkImport() : openBulkImport())}
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            {showBulkImport ? "Cancel Import" : "Bulk Import"}
          </button>
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
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
          existingProducts={products}
          onClose={closeBulkImport}
          onImported={refreshProducts}
        />
      ) : null}

      {showForm ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit Product" : "New Product"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Name
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Product Type
                </label>
                <select
                  required
                  value={form.product_type}
                  onChange={(event) =>
                    updateField("product_type", event.target.value)
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
                    updateField("category", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Unit Price
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={form.unit_price}
                  onChange={(event) =>
                    updateField("unit_price", event.target.value)
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
                    updateField("billing_cycle", event.target.value)
                  }
                  className={inputClassName}
                >
                  {BILLING_CYCLE_OPTIONS.map((option) => (
                    <option key={option.value || "none"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(event) =>
                      updateField("is_active", event.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                  />
                  Active
                </label>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Product"}
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
      ) : null}

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
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredProducts.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No products match the selected category filter.
                </td>
              </tr>
            ) : (
              filteredProducts.map((product, index) => (
                <tr key={product.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    {product.name}
                  </td>
                  <td className="px-4 py-3">
                    {formatProductType(product.product_type)}
                  </td>
                  <td className="px-4 py-3">{product.category ?? "—"}</td>
                  <td className="px-4 py-3">
                    {formatProductPrice(product.unit_price)}
                  </td>
                  <td className="px-4 py-3">
                    {formatBillingCycle(product.billing_cycle)}
                  </td>
                  <td className="px-4 py-3">
                    {formatActiveStatus(product.is_active)}
                  </td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(product)}
                    onDelete={() => handleDelete(product.id)}
                    deleting={deletingId === product.id}
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
