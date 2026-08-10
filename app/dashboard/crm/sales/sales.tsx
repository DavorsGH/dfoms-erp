"use client";

import { useMemo, useState } from "react";
import { getStripedRowClassName } from "../../finance/register-row-actions";
import {
  RegisterColumnFilterHeader,
  RegisterFilteredTotal,
  collectDistinctColumnValues,
  columnValuePassesFilter,
  type RegisterColumnFilterValue,
} from "../../finance/register-column-filter";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../scrollable-table";
import FilteredListCount, {
  anyRegisterColumnFiltersActive,
} from "../../filtered-list-count";
import {
  formatSaleAmount,
  formatSaleDate,
  formatSaleSource,
  type CrmSaleEntry,
} from "./sales-utils";

type SalesProps = {
  initialSales: CrmSaleEntry[];
  fetchError: string | null;
};

function saleStatusLabel(sale: CrmSaleEntry): string {
  if (!sale.sale_status) {
    return "—";
  }
  return sale.sale_status === "voided" ? "Voided" : "Active";
}

export default function Sales({ initialSales, fetchError }: SalesProps) {
  const [customerFilter, setCustomerFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [productFilter, setProductFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [paymentStatusFilter, setPaymentStatusFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [paymentMethodFilter, setPaymentMethodFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [sourceFilter, setSourceFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [statusFilter, setStatusFilter] =
    useState<RegisterColumnFilterValue>(null);

  const customerOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        initialSales
          .filter(
            (sale) =>
              columnValuePassesFilter(sale.product_name, productFilter) &&
              columnValuePassesFilter(
                sale.payment_status,
                paymentStatusFilter,
              ) &&
              columnValuePassesFilter(
                sale.payment_method,
                paymentMethodFilter,
              ) &&
              columnValuePassesFilter(
                formatSaleSource(sale.source),
                sourceFilter,
              ) &&
              columnValuePassesFilter(saleStatusLabel(sale), statusFilter),
          )
          .map((sale) => sale.customer_name),
      ),
    [
      initialSales,
      productFilter,
      paymentStatusFilter,
      paymentMethodFilter,
      sourceFilter,
      statusFilter,
    ],
  );

  const productOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        initialSales
          .filter(
            (sale) =>
              columnValuePassesFilter(sale.customer_name, customerFilter) &&
              columnValuePassesFilter(
                sale.payment_status,
                paymentStatusFilter,
              ) &&
              columnValuePassesFilter(
                sale.payment_method,
                paymentMethodFilter,
              ) &&
              columnValuePassesFilter(
                formatSaleSource(sale.source),
                sourceFilter,
              ) &&
              columnValuePassesFilter(saleStatusLabel(sale), statusFilter),
          )
          .map((sale) => sale.product_name),
      ),
    [
      initialSales,
      customerFilter,
      paymentStatusFilter,
      paymentMethodFilter,
      sourceFilter,
      statusFilter,
    ],
  );

  const paymentStatusOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        initialSales
          .filter(
            (sale) =>
              columnValuePassesFilter(sale.customer_name, customerFilter) &&
              columnValuePassesFilter(sale.product_name, productFilter) &&
              columnValuePassesFilter(
                sale.payment_method,
                paymentMethodFilter,
              ) &&
              columnValuePassesFilter(
                formatSaleSource(sale.source),
                sourceFilter,
              ) &&
              columnValuePassesFilter(saleStatusLabel(sale), statusFilter),
          )
          .map((sale) => sale.payment_status),
      ),
    [
      initialSales,
      customerFilter,
      productFilter,
      paymentMethodFilter,
      sourceFilter,
      statusFilter,
    ],
  );

  const paymentMethodOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        initialSales
          .filter(
            (sale) =>
              columnValuePassesFilter(sale.customer_name, customerFilter) &&
              columnValuePassesFilter(sale.product_name, productFilter) &&
              columnValuePassesFilter(
                sale.payment_status,
                paymentStatusFilter,
              ) &&
              columnValuePassesFilter(
                formatSaleSource(sale.source),
                sourceFilter,
              ) &&
              columnValuePassesFilter(saleStatusLabel(sale), statusFilter),
          )
          .map((sale) => sale.payment_method),
      ),
    [
      initialSales,
      customerFilter,
      productFilter,
      paymentStatusFilter,
      sourceFilter,
      statusFilter,
    ],
  );

  const sourceOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        initialSales
          .filter(
            (sale) =>
              columnValuePassesFilter(sale.customer_name, customerFilter) &&
              columnValuePassesFilter(sale.product_name, productFilter) &&
              columnValuePassesFilter(
                sale.payment_status,
                paymentStatusFilter,
              ) &&
              columnValuePassesFilter(
                sale.payment_method,
                paymentMethodFilter,
              ) &&
              columnValuePassesFilter(saleStatusLabel(sale), statusFilter),
          )
          .map((sale) => formatSaleSource(sale.source)),
      ),
    [
      initialSales,
      customerFilter,
      productFilter,
      paymentStatusFilter,
      paymentMethodFilter,
      statusFilter,
    ],
  );

  const statusOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        initialSales
          .filter(
            (sale) =>
              columnValuePassesFilter(sale.customer_name, customerFilter) &&
              columnValuePassesFilter(sale.product_name, productFilter) &&
              columnValuePassesFilter(
                sale.payment_status,
                paymentStatusFilter,
              ) &&
              columnValuePassesFilter(
                sale.payment_method,
                paymentMethodFilter,
              ) &&
              columnValuePassesFilter(
                formatSaleSource(sale.source),
                sourceFilter,
              ),
          )
          .map((sale) => saleStatusLabel(sale)),
      ),
    [
      initialSales,
      customerFilter,
      productFilter,
      paymentStatusFilter,
      paymentMethodFilter,
      sourceFilter,
    ],
  );

  const visibleSales = useMemo(
    () =>
      initialSales.filter(
        (sale) =>
          columnValuePassesFilter(sale.customer_name, customerFilter) &&
          columnValuePassesFilter(sale.product_name, productFilter) &&
          columnValuePassesFilter(sale.payment_status, paymentStatusFilter) &&
          columnValuePassesFilter(sale.payment_method, paymentMethodFilter) &&
          columnValuePassesFilter(
            formatSaleSource(sale.source),
            sourceFilter,
          ) &&
          columnValuePassesFilter(saleStatusLabel(sale), statusFilter),
      ),
    [
      initialSales,
      customerFilter,
      productFilter,
      paymentStatusFilter,
      paymentMethodFilter,
      sourceFilter,
      statusFilter,
    ],
  );

  const visibleAmountTotal = useMemo(() => {
    let total = 0;
    for (const sale of visibleSales) {
      total += Number(sale.amount) || 0;
    }
    return Math.round(total * 100) / 100;
  }, [visibleSales]);

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm text-slate-600">
        Combined read-only log of Product Sales (inventory) and webhook-recorded
        digital sales.
      </p>

      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}

      <FilteredListCount
        filteredCount={visibleSales.length}
        totalCount={initialSales.length}
        itemSingular="sale"
        hasActiveFilters={anyRegisterColumnFiltersActive(
          customerFilter,
          productFilter,
          paymentStatusFilter,
          paymentMethodFilter,
          sourceFilter,
          statusFilter,
        )}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Sale Date</th>
              <th className={scrollableTableThClassName}>Invoice No.</th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Customer"
                  options={customerOptions}
                  applied={customerFilter}
                  onApply={setCustomerFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Product"
                  options={productOptions}
                  applied={productFilter}
                  onApply={setProductFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>Amount</th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Payment Status"
                  options={paymentStatusOptions}
                  applied={paymentStatusFilter}
                  onApply={setPaymentStatusFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Payment Method"
                  options={paymentMethodOptions}
                  applied={paymentMethodFilter}
                  onApply={setPaymentMethodFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Source"
                  options={sourceOptions}
                  applied={sourceFilter}
                  onApply={setSourceFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Status"
                  options={statusOptions}
                  applied={statusFilter}
                  onApply={setStatusFilter}
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {initialSales.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No sales recorded yet.
                </td>
              </tr>
            ) : visibleSales.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No entries match the current filters.
                </td>
              </tr>
            ) : (
              visibleSales.map((sale, index) => {
                const voided = sale.sale_status === "voided";

                return (
                  <tr
                    key={`${sale.source}-${sale.id}`}
                    className={`${getStripedRowClassName(index)}${voided ? " opacity-60" : ""}`}
                  >
                    <td className="px-4 py-3">
                      {formatSaleDate(sale.sale_date)}
                    </td>
                    <td className="px-4 py-3">{sale.invoice_no ?? "—"}</td>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {sale.customer_name}
                    </td>
                    <td className="px-4 py-3">{sale.product_name}</td>
                    <td className="px-4 py-3">
                      {formatSaleAmount(sale.amount)}
                    </td>
                    <td className="px-4 py-3">{sale.payment_status ?? "—"}</td>
                    <td className="px-4 py-3">{sale.payment_method ?? "—"}</td>
                    <td className="px-4 py-3">
                      {formatSaleSource(sale.source)}
                    </td>
                    <td className="px-4 py-3">
                      {sale.sale_status
                        ? voided
                          ? "Voided"
                          : "Active"
                        : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>

      <RegisterFilteredTotal
        label="Amount total"
        total={visibleAmountTotal}
        visibleCount={visibleSales.length}
        totalCount={initialSales.length}
      />
    </div>
  );
}
