"use client";

import {
  formatBillingFrequencyLabel,
  formatInvoiceDate,
  formatInvoiceMoney,
  formatServiceContractStatus,
  type ServiceContractLineItemRow,
} from "@/utils/service-contracts-types";
import ServiceContractRateCard from "@/app/dashboard/finance/service-contracts/service-contract-rate-card";

export type ClientPortalContractCard = {
  id: string;
  contract_number: string;
  start_date: string;
  end_date: string;
  billing_frequency: string;
  status: string;
  subtotal: number;
  total_amount_due: number;
  document_url: string | null;
  document_signed_url: string | null;
  line_items: ServiceContractLineItemRow[];
};

type MyContractsProps = {
  contracts: ClientPortalContractCard[];
  fetchError: string | null;
};

const cardClassName =
  "space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm";

export default function MyContracts({ contracts, fetchError }: MyContractsProps) {
  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load contracts: {fetchError}
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
        No service contracts found for your account.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {contracts.map((contract) => (
        <article key={contract.id} className="space-y-6">
          <section className={cardClassName}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Service Contract
                </p>
                <h3 className="mt-1 text-xl font-semibold text-[#0f2744]">
                  {contract.contract_number}
                </h3>
              </div>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
                {formatServiceContractStatus(contract.status)}
              </span>
            </div>

            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Contract Term
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatInvoiceDate(contract.start_date)} → {formatInvoiceDate(contract.end_date)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Billing Frequency
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatBillingFrequencyLabel(contract.billing_frequency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Total per Cycle
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[#0f2744]">
                  {formatInvoiceMoney(contract.total_amount_due)}
                </dd>
              </div>
            </dl>
          </section>

          <ServiceContractRateCard
            lineItems={contract.line_items}
            subtotal={contract.subtotal}
            totalAmountDue={contract.total_amount_due}
          />

          <section className={cardClassName}>
            <h3 className="text-sm font-medium text-slate-700">Contract Document</h3>
            {contract.document_signed_url ? (
              <a
                href={contract.document_signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
              >
                View Contract Document
              </a>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No contract document uploaded yet.</p>
            )}
          </section>
        </article>
      ))}
    </div>
  );
}
