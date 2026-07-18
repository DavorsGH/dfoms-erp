"use client";

import { useMemo, useState } from "react";
import { getStripedRowClassName } from "../finance/register-row-actions";
import { inputClassName } from "../employees/employee-record-utils";
import {
  formatActiveStatus,
  formatBillingCycle,
  formatProductPrice,
  formatProductType,
  getUniqueProductCategories,
  type CrmProductEntry,
} from "../crm/products/products-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  FINANCE_REPORT_PRINT_AREA_ID,
  ReportActionBar,
  ReportCompanyHeader,
  ReportPrintStyles,
  downloadCsv,
} from "./report-ui";

function ReportFetchError({ fetchError }: { fetchError: string | null }) {
  if (!fetchError) {
    return null;
  }

  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {fetchError}
    </p>
  );
}

function handleReportPrint() {
  window.print();
}

function ReportPanel({
  title,
  periodLabel,
  children,
}: {
  title: string;
  periodLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={FINANCE_REPORT_PRINT_AREA_ID}
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <ReportCompanyHeader title={title} periodLabel={periodLabel} />
      {children}
    </div>
  );
}

export function ProductCatalogReport({
  initialProducts,
  fetchError,
}: {
  initialProducts: CrmProductEntry[];
  fetchError: string | null;
}) {
  const [categoryFilter, setCategoryFilter] = useState("");
  const periodLabel = "All products";

  const categoryOptions = useMemo(
    () => getUniqueProductCategories(initialProducts),
    [initialProducts],
  );

  const rows = useMemo(() => {
    return initialProducts.filter((product) => {
      if (!categoryFilter) {
        return true;
      }

      return (product.category ?? "") === categoryFilter;
    });
  }, [categoryFilter, initialProducts]);

  function exportCsv() {
    downloadCsv(
      "product-catalog-report.csv",
      [
        "Name",
        "Product Type",
        "Category",
        "Unit Price",
        "Billing Cycle",
        "Active",
      ],
      rows.map((product) => [
        product.name,
        formatProductType(product.product_type),
        product.category ?? "",
        product.unit_price ?? "",
        formatBillingCycle(product.billing_cycle),
        formatActiveStatus(product.is_active),
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={rows.length === 0}
      >
        <div className="min-w-[220px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Category (optional)
          </label>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
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
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <ReportPanel title="Product Catalog Report" periodLabel={periodLabel}>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No products match the selected filter.
                  </td>
                </tr>
              ) : (
                rows.map((product, index) => (
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}
