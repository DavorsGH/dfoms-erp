"use client";

import { useMemo, useState } from "react";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../scrollable-table";
import { inputClassName } from "../../hr-payroll/hr-register-utils";
import { getStripedRowClassName } from "../../finance/register-row-actions";
import {
  buildPlatformUnitActivationCatalogEntry,
  ERP_SUITE_CATEGORY,
  formatActiveStatus,
  formatBillingCycle,
  formatCatalogUnitPrice,
  formatProductType,
  getCatalogManagedLabel,
  getUniqueProductCategories,
  PLATFORM_BILLING_CATEGORY,
  type CrmProductEntry,
} from "./products-utils";

type ProductsProps = {
  initialProducts: CrmProductEntry[];
  platformUnitActivationPriceGhs: number;
  showPlatformBillingCatalogEntry: boolean;
  fetchError: string | null;
};

export default function Products({
  initialProducts,
  platformUnitActivationPriceGhs,
  showPlatformBillingCatalogEntry,
  fetchError,
}: ProductsProps) {
  const [filterCategory, setFilterCategory] = useState(ERP_SUITE_CATEGORY);

  const catalogProducts = useMemo(() => {
    const rows = showPlatformBillingCatalogEntry
      ? [
          ...initialProducts,
          buildPlatformUnitActivationCatalogEntry(platformUnitActivationPriceGhs),
        ]
      : initialProducts;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [
    initialProducts,
    platformUnitActivationPriceGhs,
    showPlatformBillingCatalogEntry,
  ]);

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
      </div>

      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
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
              <th className={scrollableTableThClassName}>Source</th>
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
                      {getCatalogManagedLabel(product)}
                    </span>
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
