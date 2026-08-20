"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { PosReceiptPanel, type PosReceiptData } from "../../pos/pos-receipt";
import RegisterRowActions, {
  getStripedRowClassName,
} from "../../finance/register-row-actions";
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
import type { ClientEntry } from "../../operations/clients-utils";
import {
  ProductSaleReceiptPanel,
  type ProductSaleReceiptData,
} from "../product-sale-receipt";
import {
  formatSaleAmount,
  formatSaleDate,
  formatSaleSource,
  type CrmSaleEntry,
} from "./sales-utils";
import {
  getSalesLogReceiptKind,
  loadSalesLogReceiptData,
} from "./sales-log-receipt-utils";

type SalesProps = {
  initialSales: CrmSaleEntry[];
  initialClients: ClientEntry[];
  fetchError: string | null;
};

type ActiveReceipt =
  | { kind: "pos"; receipt: PosReceiptData }
  | { kind: "product_sale"; receipt: ProductSaleReceiptData }
  | null;

function saleStatusLabel(sale: CrmSaleEntry): string {
  if (!sale.sale_status) {
    return "—";
  }
  return sale.sale_status === "voided" ? "Voided" : "Active";
}

export default function Sales({
  initialSales,
  initialClients,
  fetchError,
}: SalesProps) {
  const supabase = createClient();
  const [activeReceipt, setActiveReceipt] = useState<ActiveReceipt>(null);
  const [printingKey, setPrintingKey] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
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

  async function handlePrintReceipt(sale: CrmSaleEntry) {
    const rowKey = `${sale.source}-${sale.id}`;
    setPrintError(null);
    setPrintingKey(rowKey);

    try {
      const result = await loadSalesLogReceiptData(
        supabase,
        sale,
        initialClients,
      );

      if (result.kind === "unsupported") {
        setPrintError(result.reason);
        return;
      }

      if (result.kind === "pos") {
        setActiveReceipt({ kind: "pos", receipt: result.receipt });
        return;
      }

      setActiveReceipt({
        kind: "product_sale",
        receipt: result.receipt,
      });
    } catch (error) {
      setPrintError(
        error instanceof Error
          ? error.message
          : "Unable to load receipt for this sale.",
      );
    } finally {
      setPrintingKey(null);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm text-slate-600">
        Combined read-only log of Product Sales (inventory), POS checkout, and
        webhook-recorded digital sales.
      </p>

      {printError ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {printError}
        </p>
      ) : null}

      {activeReceipt?.kind === "pos" ? (
        <PosReceiptPanel
          receipt={activeReceipt.receipt}
          onPrint={() => window.print()}
          onClose={() => setActiveReceipt(null)}
        />
      ) : null}

      {activeReceipt?.kind === "product_sale" ? (
        <ProductSaleReceiptPanel
          receipt={activeReceipt.receipt}
          onPrint={() => window.print()}
          onClose={() => setActiveReceipt(null)}
        />
      ) : null}

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
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {initialSales.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No sales recorded yet.
                </td>
              </tr>
            ) : visibleSales.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No entries match the current filters.
                </td>
              </tr>
            ) : (
              visibleSales.map((sale, index) => {
                const voided = sale.sale_status === "voided";
                const rowKey = `${sale.source}-${sale.id}`;
                const canPrint = getSalesLogReceiptKind(sale) !== "unsupported";

                return (
                  <tr
                    key={rowKey}
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
                    <RegisterRowActions
                      onPrint={
                        canPrint
                          ? () => void handlePrintReceipt(sale)
                          : undefined
                      }
                      printing={printingKey === rowKey}
                    />
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
