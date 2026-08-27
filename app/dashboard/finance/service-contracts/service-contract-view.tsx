"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoadingState } from "@/components/loading-indicator";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import { formatInvoiceStatus } from "@/utils/client-invoices-types";
import {
  formatBillingFrequencyLabel,
  formatInvoiceDate,
  formatInvoiceMoney,
  formatServiceContractBillingPeriod,
  formatServiceContractTaxBasisLabel,
  normalizeServiceContractHeaderRow,
  toNumber,
  type ServiceContractGeneratedInvoice,
  type ServiceContractHeaderRow,
  type ServiceContractLineItemRow,
} from "@/utils/service-contracts-types";
import {
  ServiceContractDocumentPanel,
  ServiceContractRecordHeader,
  serviceContractCardClassName,
} from "./service-contract-display";
import ServiceContractRateCard from "./service-contract-rate-card";

type ServiceContractViewProps = {
  contractId: string;
};

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

const cardClassName = serviceContractCardClassName;

export default function ServiceContractView({ contractId }: ServiceContractViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contract, setContract] = useState<ServiceContractHeaderRow | null>(null);
  const [lineItems, setLineItems] = useState<ServiceContractLineItemRow[]>([]);
  const [generatedInvoices, setGeneratedInvoices] = useState<ServiceContractGeneratedInvoice[]>(
    [],
  );
  const [documentSignedUrl, setDocumentSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/service-contracts/${contractId}`);
      const payload = (await response.json().catch(() => null)) as
        | {
            service_contract?: ServiceContractHeaderRow;
            line_items?: ServiceContractLineItemRow[];
            generated_invoices?: ServiceContractGeneratedInvoice[];
            document_signed_url?: string | null;
            error?: string;
          }
        | null;

      if (cancelled) {
        return;
      }

      if (!response.ok || !payload?.service_contract) {
        setError(payload?.error ?? "Service contract not found.");
        setLoading(false);
        return;
      }

      setContract(normalizeServiceContractHeaderRow(payload.service_contract));
      setLineItems(
        (payload.line_items ?? []).map((line) => ({
          ...line,
          labour_amount: toNumber(line.labour_amount),
          material_amount: toNumber(line.material_amount),
          discount_amount: toNumber(line.discount_amount),
          total_cost: toNumber(line.total_cost),
        })),
      );
      setGeneratedInvoices(
        (payload.generated_invoices ?? []).map((invoice) => ({
          ...invoice,
          total_amount_due: toNumber(invoice.total_amount_due),
        })),
      );
      setDocumentSignedUrl(payload.document_signed_url ?? null);
      setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [contractId]);

  if (loading) {
    return <LoadingState label="Loading service contract…" />;
  }

  if (error || !contract) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error ?? "Service contract not found."}
      </p>
    );
  }

  const clientName = Array.isArray(contract.client)
    ? (contract.client[0]?.client_name ?? contract.client_id)
    : (contract.client?.client_name ?? contract.client_id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/dashboard/finance/service-contracts/${contractId}/edit`}
          className={secondaryButtonClassName}
        >
          Edit contract
        </Link>
        <Link href="/dashboard/finance/service-contracts" className={secondaryButtonClassName}>
          Back to list
        </Link>
      </div>

      <ServiceContractRecordHeader
        contractNumber={contract.contract_number}
        status={contract.status}
        endDate={contract.end_date}
      />

      <ServiceContractDocumentPanel
        mode="view"
        documentUrl={contract.document_url}
        documentSignedUrl={documentSignedUrl}
      />

      <section className={cardClassName}>
        <h3 className="text-sm font-medium text-slate-700">Parties &amp; Term</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Customer</p>
            <p className="mt-1 text-sm text-slate-900">{clientName}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Contract Term
            </p>
            <p className="mt-1 text-sm text-slate-900">
              {formatInvoiceDate(contract.start_date)} → {formatInvoiceDate(contract.end_date)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Auto Renew
            </p>
            <p className="mt-1 text-sm text-slate-900">{contract.auto_renew ? "Yes" : "No"}</p>
          </div>
        </div>
      </section>

      <section className={cardClassName}>
        <h3 className="text-sm font-medium text-slate-700">Billing</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Billing Frequency
            </p>
            <p className="mt-1 text-sm text-slate-900">
              {formatBillingFrequencyLabel(contract.billing_frequency)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Next Billing Date
            </p>
            <p className="mt-1 text-sm text-slate-900">
              {formatInvoiceDate(contract.next_billing_date)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tax Basis</p>
            <p className="mt-1 text-sm text-slate-900">
              {formatServiceContractTaxBasisLabel(contract.tax_basis)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              VAT/NHIL/GETFund Rate
            </p>
            <p className="mt-1 text-sm text-slate-900">{contract.vat_nhil_getfund_rate}%</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">WHT Rate</p>
            <p className="mt-1 text-sm text-slate-900">{contract.wht_rate}%</p>
          </div>
        </div>
      </section>

      {contract.notes ? (
        <section className={cardClassName}>
          <h3 className="text-sm font-medium text-slate-700">Notes</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{contract.notes}</p>
        </section>
      ) : null}

      <ServiceContractRateCard
        lineItems={lineItems}
        subtotal={contract.subtotal}
        totalAmountDue={contract.total_amount_due}
      />

      <section className={cardClassName}>
        <div className="mb-4">
          <h3 className="text-sm font-medium text-slate-700">Generated Invoices</h3>
          <p className="mt-1 text-xs text-slate-500">
            Draft and issued customer invoices created from this contract.
          </p>
        </div>

        {generatedInvoices.length === 0 ? (
          <p className="text-sm text-slate-500">No invoices generated from this contract yet.</p>
        ) : (
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Invoice #</th>
                  <th className={scrollableTableThClassName}>Period</th>
                  <th className={scrollableTableThClassName}>Status</th>
                  <th className={scrollableTableThClassName}>Total</th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white text-slate-900">
                {generatedInvoices.map((invoice, index) => (
                  <tr key={invoice.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {invoice.invoice_number}
                    </td>
                    <td className="px-4 py-3">
                      {formatServiceContractBillingPeriod(
                        invoice.billing_period_start,
                        invoice.billing_period_end,
                        invoice.invoice_date,
                      )}
                    </td>
                    <td className="px-4 py-3">{formatInvoiceStatus(invoice.status)}</td>
                    <td className="px-4 py-3">{formatInvoiceMoney(invoice.total_amount_due)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/finance/client-invoices/${invoice.id}`}
                        className={secondaryButtonClassName}
                      >
                        View invoice
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </section>
    </div>
  );
}
