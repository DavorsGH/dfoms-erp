"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import { WarningHint } from "@/components/feedback/warning-hint";
import { formatSupplierStatus } from "@/utils/suppliers-types";
import {
  getSupplier360Tabs,
  formatDate,
  formatDaysSinceLastActivity,
  formatGHS,
  supplier360AccountsPayableViewHref,
  supplier360ExpenseViewHref,
  supplier360FixedAssetViewHref,
  supplier360ProductPurchaseViewHref,
  supplier360PurchaseOrderViewHref,
  supplier360RawMaterialPurchaseViewHref,
  supplier360SupplierContractViewHref,
  supplierStatusBadgeClassName,
  type Supplier360Data,
  type Supplier360SectionErrors,
  type Supplier360SectionKey,
  type Supplier360TabId,
} from "./supplier-360-utils";

type Supplier360Props = Supplier360Data & {
  sectionErrors: Supplier360SectionErrors;
  canEditSupplier: boolean;
  /** Full Finance roles; false for operations_manager / sales_rep suppliers-only access. */
  showFinanceDetails: boolean;
};

function supplier360TabSectionKey(tabId: Supplier360TabId): Supplier360SectionKey {
  if (tabId === "purchase-orders") {
    return "purchaseOrders";
  }
  if (tabId === "accounts-payable") {
    return "payables";
  }
  if (tabId === "supplier-contracts") {
    return "contracts";
  }
  if (tabId === "fixed-assets") {
    return "fixedAssets";
  }
  if (tabId === "expenses") {
    return "expenses";
  }
  return "purchases";
}

function Supplier360SectionErrorBanner({ message }: { message: string }) {
  return (
    <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </p>
  );
}

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

const recordLinkClassName =
  "font-medium text-sky-800 underline-offset-2 hover:underline";

export default function Supplier360({
  supplier,
  summary,
  productPurchases,
  rawMaterialPurchases,
  purchaseOrders,
  payables,
  expenses,
  contracts,
  fixedAssets,
  sectionErrors,
  canEditSupplier,
  showFinanceDetails,
}: Supplier360Props) {
  const visibleTabs = getSupplier360Tabs(showFinanceDetails);
  const [activeTab, setActiveTab] = useState<Supplier360TabId>("purchases");
  const activeSectionError =
    sectionErrors[supplier360TabSectionKey(activeTab)] ?? null;

  const combinedPurchases = useMemo(() => {
    const productRows = productPurchases.map((row) => ({
      key: `product-${row.id}`,
      recordId: row.id,
      purchaseKind: "product" as const,
      sortDate: row.purchase_date,
      kind: "Product" as const,
      label: row.product_label,
      detail: row.batch_number ? `Lot ${row.batch_number}` : "—",
      amount: row.total_cost,
    }));
    const rawRows = rawMaterialPurchases.map((row) => ({
      key: `raw-${row.id}`,
      recordId: row.id,
      purchaseKind: "raw" as const,
      sortDate: row.purchase_date,
      kind: "Raw material" as const,
      label: row.material_label,
      detail: row.supplier ?? "—",
      amount: row.total_cost,
    }));
    return [...productRows, ...rawRows].sort((a, b) =>
      b.sortDate.localeCompare(a.sortDate),
    );
  }, [productPurchases, rawMaterialPurchases]);

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-semibold text-[#0f2744]">{supplier.name}</h3>
          <p className="mt-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${supplierStatusBadgeClassName(supplier.is_active)}`}
            >
              {formatSupplierStatus(supplier.is_active)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditSupplier ? (
            <Link
              href={`/dashboard/finance/suppliers?edit=${encodeURIComponent(supplier.id)}`}
              className={secondaryButtonClassName}
            >
              Edit Supplier
            </Link>
          ) : null}
          <Link href="/dashboard/finance/suppliers" className={secondaryButtonClassName}>
            Back to Suppliers
          </Link>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Contact
            </p>
            <p className="mt-1 text-sm text-slate-900">
              {supplier.contact_person ?? "—"}
            </p>
            <p className="mt-1 text-sm text-slate-600">{supplier.phone ?? "—"}</p>
            <p className="text-sm text-slate-600">{supplier.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Payment terms
            </p>
            <p className="mt-1 text-sm text-slate-900">
              {supplier.payment_terms_days} days
            </p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Address
            </p>
            <p className="mt-1 text-sm text-slate-900">{supplier.address ?? "—"}</p>
          </div>
        </div>
      </section>

      <section
        className={`grid gap-4 sm:grid-cols-2 ${showFinanceDetails ? "xl:grid-cols-4" : "xl:grid-cols-2"}`}
      >
        {showFinanceDetails && summary.kind === "finance" ? (
          <>
            <SummaryCard
              label={`Total Spent (${new Date().getFullYear()})`}
              value={formatGHS(summary.totalSpentYtd)}
              subline={`All time: ${formatGHS(summary.totalSpentAllTime)}`}
            />
            <SummaryCard
              label="Outstanding"
              value={formatGHS(summary.outstanding)}
            />
            <SummaryCard
              label="Overdue"
              value={formatGHS(summary.overdue)}
              hint={
                summary.overdue > 0 ? (
                  <WarningHint
                    tone="amber"
                    title="Overdue payables"
                    description="This is the unpaid balance on this supplier's bills whose due date has passed. Settle or reschedule in Accounts Payable."
                    ariaLabel="Overdue supplier payables"
                  />
                ) : null
              }
            />
            <SummaryCard
              label="Last Activity"
              value={formatDaysSinceLastActivity(summary.daysSinceLastActivity)}
            />
          </>
        ) : summary.kind === "purchasing" ? (
          <>
            <SummaryCard
              label="Total Purchased"
              value={formatGHS(summary.totalPurchased)}
            />
            <SummaryCard
              label="Last Activity"
              value={formatDaysSinceLastActivity(summary.daysSinceLastActivity)}
            />
          </>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-4 pt-4">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border border-b-white border-slate-200 bg-white text-[#0f2744]"
                  : "text-slate-600 hover:text-[#0f2744]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeSectionError ? (
            <Supplier360SectionErrorBanner message={activeSectionError} />
          ) : null}
          {activeTab === "purchases" ? (
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    <th className={scrollableTableThClassName}>Date</th>
                    <th className={scrollableTableThClassName}>Type</th>
                    <th className={scrollableTableThClassName}>Item</th>
                    <th className={scrollableTableThClassName}>Reference</th>
                    <th className={scrollableTableThClassName}>Amount</th>
                    <th className={scrollableTableThClassName} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {combinedPurchases.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-center text-sm text-slate-500"
                      >
                        No purchases for this supplier yet.
                      </td>
                    </tr>
                  ) : (
                    combinedPurchases.map((row, index) => (
                      <tr key={row.key} className={getStripedRowClassName(index)}>
                        <td className="px-4 py-3">{formatDate(row.sortDate)}</td>
                        <td className="px-4 py-3">{row.kind}</td>
                        <td className="px-4 py-3">{row.label}</td>
                        <td className="px-4 py-3">{row.detail}</td>
                        <td className="px-4 py-3">{formatGHS(row.amount)}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={
                              row.purchaseKind === "product"
                                ? supplier360ProductPurchaseViewHref(row.recordId)
                                : supplier360RawMaterialPurchaseViewHref(
                                    row.recordId,
                                  )
                            }
                            className={recordLinkClassName}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          ) : null}

          {activeTab === "purchase-orders" ? (
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    <th className={scrollableTableThClassName}>PO #</th>
                    <th className={scrollableTableThClassName}>Date</th>
                    <th className={scrollableTableThClassName}>Status</th>
                    <th className={scrollableTableThClassName}>Total</th>
                    <th className={scrollableTableThClassName} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {purchaseOrders.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-sm text-slate-500"
                      >
                        No purchase orders for this supplier.
                      </td>
                    </tr>
                  ) : (
                    purchaseOrders.map((row, index) => (
                      <tr key={row.id} className={getStripedRowClassName(index)}>
                        <td className="px-4 py-3 font-medium text-[#0f2744]">
                          {row.po_number}
                        </td>
                        <td className="px-4 py-3">{formatDate(row.order_date)}</td>
                        <td className="px-4 py-3">{row.status}</td>
                        <td className="px-4 py-3">{formatGHS(row.total)}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={supplier360PurchaseOrderViewHref(row.id)}
                            className={recordLinkClassName}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          ) : null}

          {activeTab === "accounts-payable" ? (
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    <th className={scrollableTableThClassName}>Invoice #</th>
                    <th className={scrollableTableThClassName}>Date</th>
                    <th className={scrollableTableThClassName}>Amount</th>
                    <th className={scrollableTableThClassName}>Paid</th>
                    <th className={scrollableTableThClassName}>Balance</th>
                    <th className={scrollableTableThClassName} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {payables.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-center text-sm text-slate-500"
                      >
                        No accounts payable for this supplier.
                      </td>
                    </tr>
                  ) : (
                    payables.map((row, index) => (
                      <tr key={row.id} className={getStripedRowClassName(index)}>
                        <td className="px-4 py-3">{row.invoice_number ?? "—"}</td>
                        <td className="px-4 py-3">{formatDate(row.invoice_date)}</td>
                        <td className="px-4 py-3">{formatGHS(row.amount)}</td>
                        <td className="px-4 py-3">{formatGHS(row.amount_paid)}</td>
                        <td className="px-4 py-3">{formatGHS(row.balance_due)}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={supplier360AccountsPayableViewHref(row.id)}
                            className={recordLinkClassName}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          ) : null}

          {activeTab === "expenses" ? (
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    <th className={scrollableTableThClassName}>Date</th>
                    <th className={scrollableTableThClassName}>Receipt</th>
                    <th className={scrollableTableThClassName}>Category</th>
                    <th className={scrollableTableThClassName}>Amount</th>
                    <th className={scrollableTableThClassName} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {expenses.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-sm text-slate-500"
                      >
                        No expenses for this supplier.
                      </td>
                    </tr>
                  ) : (
                    expenses.map((row, index) => (
                      <tr key={row.id} className={getStripedRowClassName(index)}>
                        <td className="px-4 py-3">{formatDate(row.date)}</td>
                        <td className="px-4 py-3">{row.receipt_no ?? "—"}</td>
                        <td className="px-4 py-3">{row.expense_category ?? "—"}</td>
                        <td className="px-4 py-3">{formatGHS(row.amount)}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={supplier360ExpenseViewHref(row.id)}
                            className={recordLinkClassName}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          ) : null}

          {activeTab === "supplier-contracts" ? (
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    <th className={scrollableTableThClassName}>Contract #</th>
                    <th className={scrollableTableThClassName}>Status</th>
                    <th className={scrollableTableThClassName}>Start</th>
                    <th className={scrollableTableThClassName}>End</th>
                    <th className={scrollableTableThClassName} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {contracts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-sm text-slate-500"
                      >
                        No supplier contracts for this supplier.
                      </td>
                    </tr>
                  ) : (
                    contracts.map((row, index) => (
                      <tr key={row.id} className={getStripedRowClassName(index)}>
                        <td className="px-4 py-3 font-medium text-[#0f2744]">
                          {row.contract_number}
                        </td>
                        <td className="px-4 py-3">{row.status}</td>
                        <td className="px-4 py-3">{formatDate(row.start_date)}</td>
                        <td className="px-4 py-3">
                          {row.end_date ? formatDate(row.end_date) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={supplier360SupplierContractViewHref(row.id)}
                            className={recordLinkClassName}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          ) : null}

          {activeTab === "fixed-assets" ? (
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    <th className={scrollableTableThClassName}>Asset</th>
                    <th className={scrollableTableThClassName}>Purchase date</th>
                    <th className={scrollableTableThClassName}>Cost</th>
                    <th className={scrollableTableThClassName} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {fixedAssets.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-6 text-center text-sm text-slate-500"
                      >
                        No fixed assets from this supplier.
                      </td>
                    </tr>
                  ) : (
                    fixedAssets.map((row, index) => (
                      <tr key={row.asset_id} className={getStripedRowClassName(index)}>
                        <td className="px-4 py-3">{row.asset_name}</td>
                        <td className="px-4 py-3">
                          {row.purchase_date ? formatDate(row.purchase_date) : "—"}
                        </td>
                        <td className="px-4 py-3">{formatGHS(row.total_cost)}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={supplier360FixedAssetViewHref(row.asset_id)}
                            className={recordLinkClassName}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  subline,
  hint,
}: {
  label: string;
  value: string;
  subline?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 inline-flex items-center gap-2 text-xl font-semibold text-[#0f2744]">
        {value}
        {hint}
      </p>
      {subline ? (
        <p className="mt-1 text-sm text-slate-600">{subline}</p>
      ) : null}
    </div>
  );
}
