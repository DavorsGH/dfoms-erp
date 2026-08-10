"use client";

import Link from "next/link";
import { useState } from "react";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import { formatInventoryQuantity } from "@/app/dashboard/inventory/inventory-utils";
import type { SalesActivity } from "../sales-pipeline/sales-pipeline-utils";
import type { CustomerEntry } from "./customers-utils";
import {
  CUSTOMER_360_TABS,
  computeCustomer360Summary,
  customerStatusBadgeClassName,
  formatCustomer360ContractPeriod,
  formatDaysSinceLastActivity,
  formatGHS,
  formatInvoiceDate,
  formatInvoiceMoney,
  formatInvoiceStatus,
  formatLoyaltyPoints,
  formatLoyaltyTransactionDate,
  formatLoyaltyTransactionType,
  formatCustomer360QuotationDocumentType,
  formatCustomer360QuotationStatus,
  formatQuoteMoney,
  formatQuoteStatus,
  formatQuoteType,
  getActivityTypeLabel,
  getCustomerStatusLabel,
  getCustomerTypeLabel,
  getOpportunityStageLabel,
  getProductSaleLabel,
  isActivityComplete,
  isProductSaleVoided,
  loyaltyTransactionBadgeClassName,
  quoteStatusBadgeClassName,
  type Customer360Invoice,
  type Customer360LoyaltyAccount,
  type Customer360LoyaltyTransaction,
  type Customer360Opportunity,
  type Customer360ProductSale,
  type Customer360Quotation,
  type Customer360Quote,
  type Customer360TabId,
} from "./customer-360-utils";

type Customer360Props = {
  customer: CustomerEntry;
  supervisorName: string;
  opportunities: Customer360Opportunity[];
  quotes: Customer360Quote[];
  quotations: Customer360Quotation[];
  invoices: Customer360Invoice[];
  productSales: Customer360ProductSale[];
  activities: SalesActivity[];
  loyaltyAccount: Customer360LoyaltyAccount | null;
  loyaltyTransactions: Customer360LoyaltyTransaction[];
  fetchError: string | null;
};

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

export default function Customer360({
  customer,
  supervisorName,
  opportunities,
  quotes,
  quotations,
  invoices,
  productSales,
  activities,
  loyaltyAccount,
  loyaltyTransactions,
  fetchError,
}: Customer360Props) {
  const [activeTab, setActiveTab] = useState<Customer360TabId>("opportunities");
  const summary = computeCustomer360Summary(productSales, invoices, activities);

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-600">{customer.client_id}</p>
          <h3 className="mt-1 text-2xl font-semibold text-[#0f2744]">
            {customer.client_name}
          </h3>
          <p className="mt-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${customerStatusBadgeClassName(customer.status)}`}
            >
              {getCustomerStatusLabel(customer.status)}
            </span>
            <span className="ml-2 text-sm text-slate-600">
              {getCustomerTypeLabel(customer.customer_type)}
            </span>
          </p>
        </div>
        <Link href="/dashboard/crm/customers" className={secondaryButtonClassName}>
          Back to Customer List
        </Link>
      </div>

      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Contact
            </p>
            <p className="mt-1 text-sm text-slate-900">
              {customer.contact_person ?? "—"}
            </p>
            <p className="mt-1 text-sm text-slate-600">{customer.phone ?? "—"}</p>
            <p className="text-sm text-slate-600">{customer.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Contract
            </p>
            <p className="mt-1 text-sm text-slate-900">
              {customer.contract_number ?? "—"}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {formatCustomer360ContractPeriod(customer)}
            </p>
            <p className="text-sm text-slate-600">
              Status: {customer.contract_status ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Assigned Supervisor
            </p>
            <p className="mt-1 text-sm text-slate-900">{supervisorName}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Address
            </p>
            <p className="mt-1 text-sm text-slate-900">{customer.address ?? "—"}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Total Product Sales
          </p>
          <p className="mt-2 text-xl font-semibold text-[#0f2744]">
            {formatGHS(summary.totalProductSales)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Total Invoiced
          </p>
          <p className="mt-2 text-xl font-semibold text-[#0f2744]">
            {formatInvoiceMoney(summary.totalInvoiced)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Total Received
          </p>
          <p className="mt-2 text-xl font-semibold text-[#0f2744]">
            {formatGHS(summary.totalReceived)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Days Since Last Activity
          </p>
          <p className="mt-2 text-xl font-semibold text-[#0f2744]">
            {formatDaysSinceLastActivity(summary.daysSinceLastActivity)}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-4 pt-4">
          {CUSTOMER_360_TABS.map((tab) => (
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
          {activeTab === "opportunities" ? (
            <OpportunitiesSection opportunities={opportunities} />
          ) : null}
          {activeTab === "quotes" ? (
            <QuotesSection quotes={quotes} quotations={quotations} />
          ) : null}
          {activeTab === "invoices" ? <InvoicesSection invoices={invoices} /> : null}
          {activeTab === "product-sales" ? (
            <ProductSalesSection productSales={productSales} />
          ) : null}
          {activeTab === "loyalty" ? (
            <LoyaltySection
              loyaltyAccount={loyaltyAccount}
              loyaltyTransactions={loyaltyTransactions}
            />
          ) : null}
          {activeTab === "activities" ? (
            <ActivitiesSection activities={activities} />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function OpportunitiesSection({
  opportunities,
}: {
  opportunities: Customer360Opportunity[];
}) {
  return (
    <ScrollableTable>
      <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>Opportunity</th>
            <th className={scrollableTableThClassName}>Stage</th>
            <th className={scrollableTableThClassName}>Value</th>
            <th className={scrollableTableThClassName}>Expected Close</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {opportunities.length === 0 ? (
            <EmptyRow colSpan={4} message="No opportunities for this customer." />
          ) : (
            opportunities.map((entry, index) => (
              <tr key={entry.id} className={getStripedRowClassName(index)}>
                <td className="px-4 py-3 font-medium text-[#0f2744]">
                  {entry.opportunity_name}
                </td>
                <td className="px-4 py-3">
                  {getOpportunityStageLabel(entry.stage)}
                </td>
                <td className="px-4 py-3">
                  {entry.estimated_value == null
                    ? "—"
                    : formatGHS(entry.estimated_value)}
                </td>
                <td className="px-4 py-3">
                  {formatInvoiceDate(entry.expected_close_date)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ScrollableTable>
  );
}

function QuotesSection({
  quotes,
  quotations,
}: {
  quotes: Customer360Quote[];
  quotations: Customer360Quotation[];
}) {
  return (
    <div className="space-y-8">
      <div>
        <h4 className="mb-3 text-sm font-semibold text-[#0f2744]">Product Quotes</h4>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Quote #</th>
                <th className={scrollableTableThClassName}>Type</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Total</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {quotes.length === 0 ? (
                <EmptyRow colSpan={5} message="No product quotes for this customer." />
              ) : (
                quotes.map((entry, index) => (
                  <tr key={entry.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {entry.quote_number}
                    </td>
                    <td className="px-4 py-3">{formatQuoteType(entry.quote_type)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${quoteStatusBadgeClassName(entry.status)}`}
                      >
                        {formatQuoteStatus(entry.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{formatQuoteMoney(entry.total_amount)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/crm/quotes/${entry.id}`}
                        className={secondaryButtonClassName}
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
      </div>

      <div>
        <h4 className="mb-3 text-sm font-semibold text-[#0f2744]">Quotations</h4>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Quotation #</th>
                <th className={scrollableTableThClassName}>Document</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Total</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {quotations.length === 0 ? (
                <EmptyRow colSpan={5} message="No quotations for this customer." />
              ) : (
                quotations.map((entry, index) => (
                  <tr key={entry.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {entry.quotation_number}
                    </td>
                    <td className="px-4 py-3">
                      {formatCustomer360QuotationDocumentType(entry.document_type)}
                    </td>
                    <td className="px-4 py-3">
                      {formatCustomer360QuotationStatus(entry.status)}
                    </td>
                    <td className="px-4 py-3">
                      {formatInvoiceMoney(entry.total_amount_due)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/sales-crm/quotations/${entry.id}`}
                        className={secondaryButtonClassName}
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
      </div>
    </div>
  );
}

function InvoicesSection({ invoices }: { invoices: Customer360Invoice[] }) {
  return (
    <ScrollableTable>
      <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>Invoice #</th>
            <th className={scrollableTableThClassName}>Date</th>
            <th className={scrollableTableThClassName}>Status</th>
            <th className={scrollableTableThClassName}>Total</th>
            <th className={scrollableTableThClassName}>Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {invoices.length === 0 ? (
            <EmptyRow colSpan={5} message="No invoices for this customer." />
          ) : (
            invoices.map((entry, index) => (
              <tr key={entry.id} className={getStripedRowClassName(index)}>
                <td className="px-4 py-3 font-medium text-[#0f2744]">
                  {entry.invoice_number}
                </td>
                <td className="px-4 py-3">{formatInvoiceDate(entry.invoice_date)}</td>
                <td className="px-4 py-3">{formatInvoiceStatus(entry.status)}</td>
                <td className="px-4 py-3">
                  {formatInvoiceMoney(entry.total_amount_due)}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/finance/client-invoices/${entry.id}`}
                    className={secondaryButtonClassName}
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
  );
}

function ProductSalesSection({
  productSales,
}: {
  productSales: Customer360ProductSale[];
}) {
  return (
    <ScrollableTable>
      <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>Invoice #</th>
            <th className={scrollableTableThClassName}>Date</th>
            <th className={scrollableTableThClassName}>Product</th>
            <th className={scrollableTableThClassName}>Qty</th>
            <th className={scrollableTableThClassName}>Amount</th>
            <th className={scrollableTableThClassName}>Payment Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {productSales.length === 0 ? (
            <EmptyRow colSpan={6} message="No product sales for this customer." />
          ) : (
            productSales.map((entry, index) => (
              <tr key={entry.id} className={getStripedRowClassName(index)}>
                <td className="px-4 py-3 font-medium text-[#0f2744]">
                  {entry.invoice_no}
                </td>
                <td className="px-4 py-3">{formatInvoiceDate(entry.date)}</td>
                <td className="px-4 py-3">{getProductSaleLabel(entry)}</td>
                <td className="px-4 py-3">
                  {formatInventoryQuantity(entry.sale_quantity ?? 0)}
                </td>
                <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                <td className="px-4 py-3">
                  {isProductSaleVoided(entry)
                    ? "Voided"
                    : entry.payment_status}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ScrollableTable>
  );
}

function LoyaltySection({
  loyaltyAccount,
  loyaltyTransactions,
}: {
  loyaltyAccount: Customer360LoyaltyAccount | null;
  loyaltyTransactions: Customer360LoyaltyTransaction[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Points Balance
          </p>
          <p className="mt-1 text-2xl font-semibold text-[#0f2744]">
            {formatLoyaltyPoints(loyaltyAccount?.points_balance ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Lifetime Earned
          </p>
          <p className="mt-1 text-2xl font-semibold text-[#0f2744]">
            {formatLoyaltyPoints(loyaltyAccount?.lifetime_earned ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Lifetime Redeemed
          </p>
          <p className="mt-1 text-2xl font-semibold text-[#0f2744]">
            {formatLoyaltyPoints(loyaltyAccount?.lifetime_redeemed ?? 0)}
          </p>
        </div>
      </div>

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Type</th>
              <th className={scrollableTableThClassName}>Points</th>
              <th className={scrollableTableThClassName}>Source</th>
              <th className={scrollableTableThClassName}>Reference</th>
              <th className={scrollableTableThClassName}>Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loyaltyTransactions.length === 0 ? (
              <EmptyRow colSpan={6} message="No loyalty transactions yet." />
            ) : (
              loyaltyTransactions.map((entry, index) => (
                <tr key={entry.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">
                    {formatLoyaltyTransactionDate(entry.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${loyaltyTransactionBadgeClassName(entry.transaction_type)}`}
                    >
                      {formatLoyaltyTransactionType(entry.transaction_type)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {formatLoyaltyPoints(entry.points)}
                  </td>
                  <td className="px-4 py-3">{entry.source_type ?? "—"}</td>
                  <td className="px-4 py-3">{entry.source_reference ?? "—"}</td>
                  <td className="px-4 py-3">{entry.notes ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}

function ActivitiesSection({ activities }: { activities: SalesActivity[] }) {
  return (
    <ScrollableTable>
      <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>Type</th>
            <th className={scrollableTableThClassName}>Due Date</th>
            <th className={scrollableTableThClassName}>Status</th>
            <th className={scrollableTableThClassName}>Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {activities.length === 0 ? (
            <EmptyRow colSpan={4} message="No follow-up activities for this customer." />
          ) : (
            activities.map((entry, index) => (
              <tr key={entry.id} className={getStripedRowClassName(index)}>
                <td className="px-4 py-3">
                  {getActivityTypeLabel(entry.activity_type)}
                </td>
                <td className="px-4 py-3">{formatInvoiceDate(entry.due_date)}</td>
                <td className="px-4 py-3">
                  {isActivityComplete(entry) ? "Completed" : "Open"}
                </td>
                <td className="px-4 py-3">{entry.notes ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ScrollableTable>
  );
}

function EmptyRow({
  colSpan,
  message,
}: {
  colSpan: number;
  message: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-slate-500">
        {message}
      </td>
    </tr>
  );
}
