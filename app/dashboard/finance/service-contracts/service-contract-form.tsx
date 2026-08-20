"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import LineItemsEditor, { reindexLineItems } from "@/components/line-items-editor";
import type { ClientEntry } from "@/app/dashboard/operations/clients-utils";
import type { SalesTaxBasis } from "@/app/dashboard/finance/tax-utils";
import {
  ServiceContractDocumentPanel,
  ServiceContractRecordHeader,
  serviceContractCardClassName,
  serviceContractInputClassName,
} from "./service-contract-display";
import {
  SERVICE_CONTRACT_BILLING_FREQUENCIES,
  SERVICE_CONTRACT_TAX_BASIS_OPTIONS,
  emptyLineItem,
  formatBillingFrequencyLabel,
  formatServiceContractTaxBasisLabel,
  type ServiceContractBillingFrequency,
  type ServiceContractFormLineItem,
  type ServiceContractStatus,
  type ServiceContractWriteBody,
} from "@/utils/service-contracts-types";

type ServiceContractFormState = Omit<ServiceContractWriteBody, "line_items"> & {
  line_items: ServiceContractFormLineItem[];
};

type ServiceContractFormProps = {
  mode: "create" | "edit";
  contractId?: string;
  nextContractNumberPreview?: string | null;
  existingContractNumber?: string;
  initialCustomers: ClientEntry[];
  initialForm: ServiceContractFormState;
  salesTaxBasis: SalesTaxBasis;
  initialDocumentSignedUrl?: string | null;
  fetchError?: string | null;
};

const inputClassName = serviceContractInputClassName;
const cardClassName = serviceContractCardClassName;

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function ServiceContractForm({
  mode,
  contractId,
  nextContractNumberPreview,
  existingContractNumber,
  initialCustomers,
  initialForm,
  salesTaxBasis,
  initialDocumentSignedUrl = null,
  fetchError = null,
}: ServiceContractFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<ServiceContractFormState>(initialForm);
  const [documentSignedUrl, setDocumentSignedUrl] = useState(initialDocumentSignedUrl);
  const [error, setError] = useState<string | null>(fetchError);
  const [saving, setSaving] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [pendingDocument, setPendingDocument] = useState<File[]>([]);

  const displayContractNumber = useMemo(() => {
    if (mode === "edit") {
      return existingContractNumber ?? "";
    }

    return nextContractNumberPreview?.trim() || "Assigned on save";
  }, [mode, existingContractNumber, nextContractNumberPreview]);

  function handleClientChange(clientId: string) {
    setForm((current) => ({ ...current, client_id: clientId }));
  }

  async function uploadDocument(targetContractId: string) {
    if (pendingDocument.length === 0) {
      return form.document_url ?? null;
    }

    setUploadingDocument(true);
    const formData = new FormData();
    formData.set("contract_id", targetContractId);
    formData.set("file", pendingDocument[0]);

    const response = await fetch("/api/service-contracts/upload-document", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json().catch(() => null)) as
      | { document_url?: string; signed_url?: string | null; error?: string }
      | null;

    setUploadingDocument(false);

    if (!response.ok) {
      throw new Error(payload?.error ?? "Unable to upload contract document.");
    }

    const documentUrl = payload?.document_url ?? null;
    if (payload?.signed_url) {
      setDocumentSignedUrl(payload.signed_url);
    }
    setPendingDocument([]);
    return documentUrl;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      let savedContractId = contractId;
      const payload: ServiceContractWriteBody = {
        client_id: form.client_id,
        start_date: form.start_date,
        end_date: form.end_date,
        auto_renew: form.auto_renew,
        billing_frequency: form.billing_frequency,
        next_billing_date: form.next_billing_date,
        status: form.status,
        tax_basis: form.tax_basis,
        vat_nhil_getfund_rate: form.vat_nhil_getfund_rate,
        wht_rate: form.wht_rate,
        document_url: form.document_url,
        notes: form.notes,
        line_items: reindexLineItems(form.line_items).map(({ key: _key, ...line }) => line),
      };

      const response = await fetch(
        mode === "create" ? "/api/service-contracts" : `/api/service-contracts/${contractId}`,
        {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const result = (await response.json().catch(() => null)) as
        | { service_contract?: { id: string }; error?: string }
        | null;

      if (!response.ok) {
        setError(result?.error ?? "Unable to save service contract.");
        setSaving(false);
        return;
      }

      savedContractId = result?.service_contract?.id ?? savedContractId;

      if (savedContractId && pendingDocument.length > 0) {
        const documentUrl = await uploadDocument(savedContractId);
        if (documentUrl) {
          setForm((current) => ({ ...current, document_url: documentUrl }));
        }
      }

      router.push(
        savedContractId
          ? `/dashboard/finance/service-contracts/${savedContractId}`
          : "/dashboard/finance/service-contracts",
      );
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save service contract.",
      );
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ServiceContractRecordHeader
        contractNumber={displayContractNumber || "Assigned on save"}
        status={(form.status ?? "draft") as ServiceContractStatus}
        endDate={form.end_date}
        editable
        onStatusChange={(status) => setForm((current) => ({ ...current, status }))}
      />

      <ServiceContractDocumentPanel
        mode="edit"
        documentUrl={form.document_url}
        documentSignedUrl={documentSignedUrl}
        pendingFiles={pendingDocument}
        onPendingFilesChange={setPendingDocument}
        disabled={saving || uploadingDocument}
      />

      <section className={cardClassName}>
        <h3 className="text-sm font-medium text-slate-700">Parties &amp; Term</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Customer *
            </label>
            <select
              required
              value={form.client_id}
              onChange={(event) => handleClientChange(event.target.value)}
              className={inputClassName}
            >
              <option value="">Select customer</option>
              {initialCustomers.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.client_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Start Date *
            </label>
            <input
              type="date"
              required
              value={form.start_date}
              onChange={(event) =>
                setForm((current) => ({ ...current, start_date: event.target.value }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              End Date *
            </label>
            <input
              type="date"
              required
              value={form.end_date}
              onChange={(event) =>
                setForm((current) => ({ ...current, end_date: event.target.value }))
              }
              className={inputClassName}
            />
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <input
              id="auto-renew"
              type="checkbox"
              checked={form.auto_renew ?? false}
              onChange={(event) =>
                setForm((current) => ({ ...current, auto_renew: event.target.checked }))
              }
              className="h-4 w-4 rounded border-slate-300 text-[#0f2744]"
            />
            <label htmlFor="auto-renew" className="text-sm text-slate-700">
              Auto-renew when the contract end date is reached
            </label>
          </div>
        </div>
      </section>

      <section className={cardClassName}>
        <h3 className="text-sm font-medium text-slate-700">Billing</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Billing Frequency
            </label>
            <select
              value={form.billing_frequency ?? "monthly"}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  billing_frequency: event.target.value as ServiceContractBillingFrequency,
                }))
              }
              className={inputClassName}
            >
              {SERVICE_CONTRACT_BILLING_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {formatBillingFrequencyLabel(frequency)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Next Billing Date
            </label>
            <input
              type="date"
              value={form.next_billing_date ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  next_billing_date: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Tax Basis
            </label>
            <select
              value={form.tax_basis ?? salesTaxBasis}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  tax_basis: event.target.value as SalesTaxBasis,
                }))
              }
              className={inputClassName}
            >
              {SERVICE_CONTRACT_TAX_BASIS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {formatServiceContractTaxBasisLabel(form.tax_basis ?? salesTaxBasis)}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              VAT/NHIL/GETFund Rate (%)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.vat_nhil_getfund_rate ?? 0}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  vat_nhil_getfund_rate: Number(event.target.value) || 0,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              WHT Rate (%)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.wht_rate ?? 0}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  wht_rate: Number(event.target.value) || 0,
                }))
              }
              className={inputClassName}
            />
          </div>
        </div>
      </section>

      <LineItemsEditor
        lineItems={form.line_items}
        onLineItemsChange={(line_items) => setForm((current) => ({ ...current, line_items }))}
        itemSource="none"
        vatRate={form.vat_nhil_getfund_rate ?? 0}
        whtRate={form.wht_rate ?? 0}
        taxBasis={form.tax_basis ?? salesTaxBasis}
        disabled={saving || uploadingDocument}
        sectionTitle="Rate Card"
        sectionDescription="Contract pricing lines. Same category labels group on the contract view."
        removeButtonLabel="Remove"
        showInlineTotals
        createManualLine={emptyLineItem}
      />

      <section className={cardClassName}>
        <label className="mb-1 block text-sm font-medium text-slate-700">Notes</label>
        <textarea
          rows={4}
          value={form.notes ?? ""}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
          className={inputClassName}
        />
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving || uploadingDocument}
          className={primaryButtonClassName}
        >
          {saving || uploadingDocument ? "Saving…" : "Save Contract"}
        </button>
        <Link href="/dashboard/finance/service-contracts" className={secondaryButtonClassName}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
