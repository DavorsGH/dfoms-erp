"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getStripedRowClassName } from "../finance/register-row-actions";
import { inputClassName } from "../employees/employee-record-utils";
import { formatInventoryMoney, formatInventoryQuantity } from "../inventory/inventory-utils";
import type { RawMaterialRecord } from "../inventory/raw-materials-utils";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import type { ProductionBatchRecord } from "../inventory/production-batches-utils";
import type { FinishedProductAverageCostRow } from "../inventory/inventory-balance-sheet-utils";
import type { InternalConsumptionRecord } from "../inventory/internal-consumption-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  buildInternalConsumptionReport,
  buildProductSalesReport,
  buildProductionHistoryReport,
  buildStockOnHandReport,
  formatMarginPercent,
  PRODUCT_SALE_BUYER_TYPE_LABELS,
  type ProductSaleBuyerTypeFilter,
  type ProductSaleReportRecord,
} from "./inventory-reports-utils";
import {
  FINANCE_REPORT_PRINT_AREA_ID,
  ReportActionBar,
  ReportCompanyHeader,
  ReportPrintStyles,
  downloadCsv,
  formatReportCurrency,
  formatReportDate,
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

function DateRangeFilters({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: {
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          From (optional)
        </label>
        <input
          type="date"
          value={startDate}
          onChange={(event) => onStartDateChange(event.target.value)}
          className={inputClassName}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          To (optional)
        </label>
        <input
          type="date"
          value={endDate}
          onChange={(event) => onEndDateChange(event.target.value)}
          className={inputClassName}
        />
      </div>
    </div>
  );
}

export function StockOnHandReport({
  initialRawMaterials,
  initialFinishedProducts,
  initialAverageCosts,
  lowStockRawMaterialCount,
  fetchError,
}: {
  initialRawMaterials: RawMaterialRecord[];
  initialFinishedProducts: FinishedProductRecord[];
  initialAverageCosts: FinishedProductAverageCostRow[];
  lowStockRawMaterialCount: number;
  fetchError: string | null;
}) {
  const searchParams = useSearchParams();
  const lowStockOnly = searchParams.get("lowStock") === "1";
  const report = useMemo(
    () =>
      buildStockOnHandReport(
        initialRawMaterials,
        initialFinishedProducts,
        initialAverageCosts,
        { lowStockOnly },
      ),
    [initialAverageCosts, initialFinishedProducts, initialRawMaterials, lowStockOnly],
  );

  const handleExport = () => {
    downloadCsv(
      "stock-on-hand.csv",
      [
        "Section",
        "Item",
        "Unit",
        "Current Stock",
        "Average Cost / Unit",
        "Total Stock Value",
        "Reorder Level / Selling Price",
        "Low Stock",
      ],
      [
        ...report.rawMaterialRows.map((row) => [
          "Raw Material",
          row.materialName,
          row.unit,
          row.currentStock,
          row.averageCostPerUnit,
          row.totalStockValue,
          row.reorderLevel ?? "",
          row.isLowStock ? "Yes" : "No",
        ]),
        ...report.finishedProductRows.map((row) => [
          "Finished Product",
          row.productName,
          row.unit,
          row.currentStock,
          row.averageCostPerUnit,
          row.totalStockValue,
          row.standardSellingPrice ?? "",
          "",
        ]),
      ],
    );
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError fetchError={fetchError} />

      {lowStockRawMaterialCount > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {lowStockRawMaterialCount} raw material
          {lowStockRawMaterialCount === 1 ? "" : "s"} at or below reorder level.{" "}
          {lowStockOnly ? (
            <Link
              href="/dashboard/reports/inventory/stock-on-hand"
              className="font-medium underline"
            >
              Show all stock
            </Link>
          ) : (
            <Link
              href="/dashboard/reports/inventory/stock-on-hand?lowStock=1"
              className="font-medium underline"
            >
              View low-stock items only
            </Link>
          )}
        </p>
      ) : null}

      <ReportActionBar onPrint={handleReportPrint} onExportCsv={handleExport} />

      <ReportPanel
        title="Stock on Hand Report"
        periodLabel={
          lowStockOnly
            ? "Live snapshot — low-stock raw materials only"
            : "Live snapshot as of now"
        }
      >
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[#0f2744]">Raw Materials</h3>
              <p className="text-sm text-slate-600">
                Section total value:{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatInventoryMoney(report.rawMaterialsTotalValue)}
                </span>
              </p>
            </div>
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    {[
                      "Material",
                      "Unit",
                      "Current Stock",
                      "Avg Cost / Unit",
                      "Total Stock Value",
                      "Reorder Level",
                      "Status",
                    ].map((heading) => (
                      <th key={heading} className={scrollableTableThClassName}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {report.rawMaterialRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        {lowStockOnly
                          ? "No raw materials are currently below reorder level."
                          : "No raw materials found."}
                      </td>
                    </tr>
                  ) : (
                    report.rawMaterialRows.map((row, index) => (
                      <tr key={row.id} className={getStripedRowClassName(index)}>
                        <td
                          className={`px-4 py-3 ${row.isLowStock ? "font-medium text-red-700" : ""}`}
                        >
                          {row.materialName}
                        </td>
                        <td className="px-4 py-3">{row.unit}</td>
                        <td
                          className={`px-4 py-3 ${row.isLowStock ? "font-medium text-red-700" : ""}`}
                        >
                          {formatInventoryQuantity(row.currentStock)}
                        </td>
                        <td className="px-4 py-3">
                          {formatInventoryMoney(row.averageCostPerUnit)}
                        </td>
                        <td className="px-4 py-3">
                          {formatInventoryMoney(row.totalStockValue)}
                        </td>
                        <td className="px-4 py-3">
                          {row.reorderLevel == null
                            ? "—"
                            : formatInventoryQuantity(row.reorderLevel)}
                        </td>
                        <td className="px-4 py-3">
                          {row.isLowStock ? (
                            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                              Low Stock
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[#0f2744]">
                Finished Products
              </h3>
              <p className="text-sm text-slate-600">
                Section total value:{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatInventoryMoney(report.finishedProductsTotalValue)}
                </span>
              </p>
            </div>
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    {[
                      "Product",
                      "Unit",
                      "Current Stock",
                      "Avg Cost / Unit",
                      "Total Stock Value",
                      "Standard Selling Price",
                    ].map((heading) => (
                      <th key={heading} className={scrollableTableThClassName}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {report.finishedProductRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No finished products found.
                      </td>
                    </tr>
                  ) : (
                    report.finishedProductRows.map((row, index) => (
                      <tr key={row.id} className={getStripedRowClassName(index)}>
                        <td className="px-4 py-3">{row.productName}</td>
                        <td className="px-4 py-3">{row.unit}</td>
                        <td className="px-4 py-3">
                          {formatInventoryQuantity(row.currentStock)}
                        </td>
                        <td className="px-4 py-3">
                          {formatInventoryMoney(row.averageCostPerUnit)}
                        </td>
                        <td className="px-4 py-3">
                          {formatInventoryMoney(row.totalStockValue)}
                        </td>
                        <td className="px-4 py-3">
                          {row.standardSellingPrice == null
                            ? "—"
                            : formatInventoryMoney(row.standardSellingPrice)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          </section>
        </div>
      </ReportPanel>
    </div>
  );
}

export function ProductionHistoryReport({
  initialBatches,
  productOptions,
  fetchError,
}: {
  initialBatches: ProductionBatchRecord[];
  productOptions: Array<{ id: string; product_name: string }>;
  fetchError: string | null;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [productId, setProductId] = useState("");
  const rows = useMemo(
    () =>
      buildProductionHistoryReport(
        initialBatches,
        startDate || null,
        endDate || null,
        productId || null,
      ),
    [endDate, initialBatches, productId, startDate],
  );

  const handleExport = () => {
    downloadCsv(
      "production-history.csv",
      [
        "Batch Number",
        "Date",
        "Product",
        "Quantity Produced",
        "Materials Consumed",
        "Total Batch Cost",
        "Cost Per Unit",
      ],
      rows.map((row) => [
        row.batchNumber,
        row.productionDate,
        row.productName,
        `${row.quantityProduced} ${row.unit}`,
        row.materialsConsumed,
        row.totalBatchCost,
        row.costPerUnit,
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError fetchError={fetchError} />
      <ReportActionBar onPrint={handleReportPrint} onExportCsv={handleExport}>
        <div className="flex flex-wrap items-end gap-4">
          <DateRangeFilters
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Product (optional)
            </label>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className={inputClassName}
            >
              <option value="">All products</option>
              {productOptions.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.product_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </ReportActionBar>

      <ReportPanel title="Production History Report" periodLabel="Filtered batches">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {[
                  "Batch No.",
                  "Date",
                  "Product",
                  "Qty Produced",
                  "Materials Consumed",
                  "Total Batch Cost",
                  "Cost / Unit",
                ].map((heading) => (
                  <th key={heading} className={scrollableTableThClassName}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No production batches match the selected filters.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{row.batchNumber}</td>
                    <td className="px-4 py-3">{formatReportDate(row.productionDate)}</td>
                    <td className="px-4 py-3">{row.productName}</td>
                    <td className="px-4 py-3">
                      {formatInventoryQuantity(row.quantityProduced)} {row.unit}
                    </td>
                    <td className="px-4 py-3 text-sm">{row.materialsConsumed}</td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.totalBatchCost)}
                    </td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.costPerUnit)}
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

export function ProductSalesReport({
  initialSales,
  clientOptions,
  productOptions,
  fetchError,
}: {
  initialSales: ProductSaleReportRecord[];
  clientOptions: Array<{ client_id: string; client_name: string }>;
  productOptions: Array<{ id: string; product_name: string }>;
  fetchError: string | null;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [clientId, setClientId] = useState("");
  const [productId, setProductId] = useState("");
  const [buyerTypeFilter, setBuyerTypeFilter] =
    useState<ProductSaleBuyerTypeFilter>("all");
  const report = useMemo(
    () =>
      buildProductSalesReport(
        initialSales,
        startDate || null,
        endDate || null,
        clientId || null,
        productId || null,
        buyerTypeFilter,
      ),
    [buyerTypeFilter, clientId, endDate, initialSales, productId, startDate],
  );

  const handleExport = () => {
    downloadCsv(
      "product-sales.csv",
      [
        "Date",
        "Buyer Type",
        "Client/Customer",
        "Product",
        "Quantity",
        "Unit Price",
        "Revenue",
        "COGS",
        "Gross Margin",
        "Margin %",
      ],
      [
        ...report.rows.map((row) => [
          row.date,
          row.buyerTypeLabel,
          row.customerName,
          row.productName,
          `${row.quantity} ${row.unit}`,
          row.unitPrice,
          row.revenue,
          row.cogs,
          row.grossMargin,
          row.marginPercent,
        ]),
        [
          "TOTAL",
          "",
          "",
          "",
          "",
          "",
          report.totals.revenue,
          report.totals.cogs,
          report.totals.grossMargin,
          report.totals.marginPercent,
        ],
        [
          PRODUCT_SALE_BUYER_TYPE_LABELS.contract_client,
          "",
          "",
          "",
          "",
          "",
          report.splitTotals.contract_client.revenue,
          report.splitTotals.contract_client.cogs,
          report.splitTotals.contract_client.grossMargin,
          report.splitTotals.contract_client.marginPercent,
        ],
        [
          PRODUCT_SALE_BUYER_TYPE_LABELS.retail,
          "",
          "",
          "",
          "",
          "",
          report.splitTotals.retail.revenue,
          report.splitTotals.retail.cogs,
          report.splitTotals.retail.grossMargin,
          report.splitTotals.retail.marginPercent,
        ],
      ],
    );
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError fetchError={fetchError} />
      <ReportActionBar onPrint={handleReportPrint} onExportCsv={handleExport}>
        <div className="flex flex-wrap items-end gap-4">
          <DateRangeFilters
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Buyer Type
            </label>
            <select
              value={buyerTypeFilter}
              onChange={(event) =>
                setBuyerTypeFilter(event.target.value as ProductSaleBuyerTypeFilter)
              }
              className={inputClassName}
            >
              <option value="all">All</option>
              <option value="contract_client">Contract Client Only</option>
              <option value="retail">Retail Only</option>
            </select>
          </div>
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Client (optional)
            </label>
            <select
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              className={inputClassName}
            >
              <option value="">All clients</option>
              {clientOptions.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.client_name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Product (optional)
            </label>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className={inputClassName}
            >
              <option value="">All products</option>
              {productOptions.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.product_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </ReportActionBar>

      <ReportPanel title="Product Sales Report" periodLabel="Filtered product sales">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {[
                  "Date",
                  "Buyer Type",
                  "Client / Customer",
                  "Product",
                  "Quantity",
                  "Unit Price",
                  "Revenue",
                  "COGS",
                  "Gross Margin",
                  "Margin %",
                ].map((heading) => (
                  <th key={heading} className={scrollableTableThClassName}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    No product sales match the selected filters.
                  </td>
                </tr>
              ) : (
                report.rows.map((row, index) => (
                  <tr key={row.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{formatReportDate(row.date)}</td>
                    <td className="px-4 py-3">{row.buyerTypeLabel}</td>
                    <td className="px-4 py-3">{row.customerName}</td>
                    <td className="px-4 py-3">{row.productName}</td>
                    <td className="px-4 py-3">
                      {formatInventoryQuantity(row.quantity)} {row.unit}
                    </td>
                    <td className="px-4 py-3">{formatReportCurrency(row.unitPrice)}</td>
                    <td className="px-4 py-3">{formatReportCurrency(row.revenue)}</td>
                    <td className="px-4 py-3">{formatReportCurrency(row.cogs)}</td>
                    <td className="px-4 py-3">
                      {formatReportCurrency(row.grossMargin)}
                    </td>
                    <td className="px-4 py-3">{formatMarginPercent(row.marginPercent)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {report.rows.length > 0 ? (
              <tfoot>
                <tr className="bg-slate-100 font-semibold text-[#0f2744]">
                  <td className="px-4 py-3" colSpan={6}>
                    Period Totals
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.totals.revenue)}
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.totals.cogs)}
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.totals.grossMargin)}
                  </td>
                  <td className="px-4 py-3">
                    {formatMarginPercent(report.totals.marginPercent)}
                  </td>
                </tr>
                <tr className="bg-slate-50 font-medium text-slate-700">
                  <td className="px-4 py-3" colSpan={6}>
                    {PRODUCT_SALE_BUYER_TYPE_LABELS.contract_client}
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.splitTotals.contract_client.revenue)}
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.splitTotals.contract_client.cogs)}
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(
                      report.splitTotals.contract_client.grossMargin,
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {formatMarginPercent(
                      report.splitTotals.contract_client.marginPercent,
                    )}
                  </td>
                </tr>
                <tr className="bg-slate-50 font-medium text-slate-700">
                  <td className="px-4 py-3" colSpan={6}>
                    {PRODUCT_SALE_BUYER_TYPE_LABELS.retail}
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.splitTotals.retail.revenue)}
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.splitTotals.retail.cogs)}
                  </td>
                  <td className="px-4 py-3">
                    {formatReportCurrency(report.splitTotals.retail.grossMargin)}
                  </td>
                  <td className="px-4 py-3">
                    {formatMarginPercent(report.splitTotals.retail.marginPercent)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

export function InternalConsumptionReport({
  initialEntries,
  productOptions,
  clientOptions,
  siteOptions,
  fetchError,
}: {
  initialEntries: InternalConsumptionRecord[];
  productOptions: Array<{ id: string; product_name: string }>;
  clientOptions: Array<{ client_id: string; client_name: string }>;
  siteOptions: Array<{ site_code: string; site_name: string; client_id: string | null }>;
  fetchError: string | null;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [productId, setProductId] = useState("");
  const [clientId, setClientId] = useState("");
  const [siteId, setSiteId] = useState("");

  const filteredSiteOptions = useMemo(() => {
    if (!clientId) {
      return siteOptions;
    }

    return siteOptions.filter((site) => site.client_id === clientId);
  }, [clientId, siteOptions]);

  const report = useMemo(
    () =>
      buildInternalConsumptionReport(
        initialEntries,
        startDate || null,
        endDate || null,
        productId || null,
        clientId || null,
        siteId || null,
      ),
    [clientId, endDate, initialEntries, productId, siteId, startDate],
  );

  const handleExport = () => {
    downloadCsv(
      "internal-consumption.csv",
      ["Date", "Client", "Site", "Product", "Quantity", "Reason", "Recorded By"],
      report.rows.map((row) => [
        row.consumptionDate,
        row.clientName,
        row.siteName,
        row.productName,
        `${row.quantity} ${row.unit}`,
        row.reason,
        row.recordedBy,
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <ReportPrintStyles />
      <ReportFetchError fetchError={fetchError} />
      <ReportActionBar onPrint={handleReportPrint} onExportCsv={handleExport}>
        <div className="flex flex-wrap items-end gap-4">
          <DateRangeFilters
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Client (optional)
            </label>
            <select
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
                setSiteId("");
              }}
              className={inputClassName}
            >
              <option value="">All clients</option>
              {clientOptions.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.client_name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Site (optional)
            </label>
            <select
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
              className={inputClassName}
            >
              <option value="">
                {clientId ? "All sites for client" : "All sites"}
              </option>
              {filteredSiteOptions.map((site) => (
                <option key={site.site_code} value={site.site_code}>
                  {site.site_name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Product (optional)
            </label>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className={inputClassName}
            >
              <option value="">All products</option>
              {productOptions.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.product_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </ReportActionBar>

      <ReportPanel
        title="Internal Consumption Report"
        periodLabel="Filtered internal use"
      >
        {report.productTotals.length > 0 ? (
          <div className="mb-6 rounded-md border border-slate-200 bg-slate-50 p-4">
            <h4 className="mb-3 text-sm font-semibold text-[#0f2744]">
              Total Quantity Consumed by Product (Period)
            </h4>
            <div className="flex flex-wrap gap-3">
              {report.productTotals.map((total) => (
                <span
                  key={total.productId}
                  className="rounded-md bg-white px-3 py-2 text-sm ring-1 ring-slate-200"
                >
                  {total.productName}: {formatInventoryQuantity(total.totalQuantity)}{" "}
                  {total.unit}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {[
                  "Date",
                  "Client",
                  "Site",
                  "Product",
                  "Quantity",
                  "Reason",
                  "Recorded By",
                ].map((heading) => (
                  <th key={heading} className={scrollableTableThClassName}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No internal consumption entries match the selected filters.
                  </td>
                </tr>
              ) : (
                report.rows.map((row, index) => (
                  <tr key={row.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">
                      {formatReportDate(row.consumptionDate)}
                    </td>
                    <td className="px-4 py-3">{row.clientName}</td>
                    <td className="px-4 py-3">{row.siteName}</td>
                    <td className="px-4 py-3">{row.productName}</td>
                    <td className="px-4 py-3">
                      {formatInventoryQuantity(row.quantity)} {row.unit}
                    </td>
                    <td className="px-4 py-3">{row.reason}</td>
                    <td className="px-4 py-3">{row.recordedBy}</td>
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
