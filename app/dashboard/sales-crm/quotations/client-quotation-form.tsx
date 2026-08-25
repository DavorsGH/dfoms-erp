"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import LineItemsEditor, { reindexLineItems } from "@/components/line-items-editor";
import { useTenantBranding } from "@/app/dashboard/tenant-branding-context";
import type { BillingSettingsHeaderFields } from "@/utils/billing-settings-types";
import type { ClientEntry } from "@/app/dashboard/operations/clients-utils";
import type { FinishedProductRecord } from "@/app/dashboard/inventory/finished-products-utils";
import { formatAuthorizedSignerLabel } from "@/utils/client-invoices-types";
import type { PaymentAccountRow } from "@/utils/payment-accounts-types";
import {
  AUTHORIZED_BY_OTHER,
  CLIENT_QUOTATION_PAYMENT_TERMS_OPTIONS,
  computeQuotationTotals,
  defaultTaxBasisForQuotationType,
  emptyProductQuotationLineItem,
  emptyQuotationLineItem,
  formatInvoiceMoney,
  normalizeClientQuotationPaymentTerms,
  normalizeQuotationDiscountType,
  normalizeQuotationType,
  quotationHeaderDiscountLabel,
  quotationHasBeenSent,
  QUOTATION_TAX_BASIS_OPTIONS,
  resolveAuthorizedByFields,
  resolveQuotationTaxBasis,
  type ClientInvoiceAuthorizedSignerOption,
  type ClientQuotationDiscountType,
  type ClientInvoiceFormAuthorizedByState,
  type ClientQuotationDocumentType,
  type ClientQuotationFormLineItem,
  type ClientQuotationPipelineOpportunityOption,
  type ClientQuotationSiteOption,
  type ClientQuotationStatus,
  type ClientQuotationType,
  type ClientQuotationWriteBody,
} from "@/utils/client-quotations-types";
import {
  buildClientQuotationPreviewDisplay,
} from "./client-quotation-display-utils";
import ClientQuotationPreviewDialog from "./client-quotation-preview-dialog";

type ClientQuotationFormState = Omit<
  ClientQuotationWriteBody,
  "line_items" | "ship_to_name" | "ship_to_address" | "ship_to_phone"
> &
  ClientInvoiceFormAuthorizedByState & {
    line_items: ClientQuotationFormLineItem[];
    ship_to_same_as_billing: boolean;
    ship_to_name: string;
    ship_to_address: string;
    ship_to_phone: string;
  };

type ClientQuotationFormProps = {
  mode: "create" | "edit";
  tenantId: string;
  quotationId?: string;
  /** Non-allocating preview of the next server-assigned quotation number. */
  nextQuotationNumberPreview?: string | null;
  existingQuotationNumber?: string;
  isConverted?: boolean;
  billingSettings?: BillingSettingsHeaderFields | null;
  initialCustomers: ClientEntry[];
  initialOpportunities: ClientQuotationPipelineOpportunityOption[];
  initialSites: ClientQuotationSiteOption[];
  initialPaymentAccounts: PaymentAccountRow[];
  initialAuthorizedSigners: ClientInvoiceAuthorizedSignerOption[];
  initialProducts?: FinishedProductRecord[];
  initialForm: ClientQuotationFormState;
  fetchError?: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const cardClassName =
  "space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function resolveShipToPayload(form: ClientQuotationFormState) {
  if (form.ship_to_same_as_billing) {
    return {
      ship_to_name: null,
      ship_to_address: null,
      ship_to_phone: null,
    };
  }

  return {
    ship_to_name: form.ship_to_name.trim() || null,
    ship_to_address: form.ship_to_address.trim() || null,
    ship_to_phone: form.ship_to_phone.trim() || null,
  };
}

export default function ClientQuotationForm({
  mode,
  tenantId,
  quotationId,
  nextQuotationNumberPreview,
  existingQuotationNumber,
  isConverted = false,
  billingSettings = null,
  initialCustomers,
  initialOpportunities,
  initialSites,
  initialPaymentAccounts,
  initialAuthorizedSigners,
  initialProducts = [],
  initialForm,
  fetchError = null,
}: ClientQuotationFormProps) {
  const router = useRouter();
  const branding = useTenantBranding();
  const [form, setForm] = useState<ClientQuotationFormState>(initialForm);
  const [error, setError] = useState<string | null>(fetchError);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const clientSites = useMemo(
    () =>
      form.client_id
        ? initialSites.filter((site) => site.client_id === form.client_id)
        : [],
    [form.client_id, initialSites],
  );

  const clientOpportunities = useMemo(
    () =>
      form.client_id
        ? initialOpportunities.filter(
            (entry) => entry.client_id === form.client_id,
          )
        : [],
    [form.client_id, initialOpportunities],
  );

  const isProductQuotation = normalizeQuotationType(form.quotation_type) === "product";

  const totals = useMemo(
    () =>
      computeQuotationTotals(
        form.line_items,
        form.vat_nhil_getfund_rate,
        form.wht_rate,
        resolveQuotationTaxBasis(
          form.tax_basis,
          normalizeQuotationType(form.quotation_type),
        ),
        form.header_discount_amount ?? 0,
        normalizeQuotationType(form.quotation_type),
        normalizeQuotationDiscountType(form.discount_type),
        form.discount_percentage ?? 0,
      ),
    [
      form.line_items,
      form.vat_nhil_getfund_rate,
      form.wht_rate,
      form.tax_basis,
      form.header_discount_amount,
      form.discount_type,
      form.discount_percentage,
      form.quotation_type,
    ],
  );

  const discountType = normalizeQuotationDiscountType(form.discount_type);
  const headerDiscountPreviewLabel = quotationHeaderDiscountLabel({
    discount_type: discountType,
    header_discount_amount: totals.header_discount_amount,
    discount_percentage: form.discount_percentage ?? 0,
  });

  const displayQuotationNumber = useMemo(() => {
    if (mode === "edit") {
      return existingQuotationNumber ?? "";
    }

    return nextQuotationNumberPreview?.trim() || "Assigned on save";
  }, [mode, existingQuotationNumber, nextQuotationNumberPreview]);

  const previewDisplay = useMemo(() => {
    if (!previewOpen) {
      return null;
    }

    const authorizedBy = resolveAuthorizedByFields(
      form.authorized_by_selection,
      form.authorized_by_other_name,
      form.authorized_by_other_title,
      initialAuthorizedSigners,
    );
    const opportunity = clientOpportunities.find(
      (entry) => entry.id === form.opportunity_id,
    );

    return buildClientQuotationPreviewDisplay({
      tenantId,
      quotationNumber: displayQuotationNumber || "Draft",
      form: {
        client_id: form.client_id,
        opportunity_id: form.opportunity_id?.trim() || null,
        document_type: form.document_type,
        quotation_type: normalizeQuotationType(form.quotation_type),
        tax_basis: resolveQuotationTaxBasis(
          form.tax_basis,
          normalizeQuotationType(form.quotation_type),
        ),
        issue_date: form.issue_date,
        valid_until: form.valid_until || null,
        bill_to_name: form.bill_to_name,
        bill_to_address: form.bill_to_address,
        bill_to_phone: form.bill_to_phone,
        ...resolveShipToPayload(form),
        vat_nhil_getfund_rate: form.vat_nhil_getfund_rate,
        wht_rate: form.wht_rate,
        header_discount_amount: isProductQuotation
          ? form.header_discount_amount ?? 0
          : 0,
        discount_type: isProductQuotation ? discountType : "flat",
        discount_percentage: isProductQuotation
          ? form.discount_percentage ?? 0
          : null,
        status: form.status,
        notes: form.notes,
        commercial_terms: form.commercial_terms?.trim() || null,
        internal_notes: form.internal_notes?.trim() || null,
        payment_terms: normalizeClientQuotationPaymentTerms(form.payment_terms),
        authorized_by_name: authorizedBy.authorized_by_name,
        authorized_by_title: authorizedBy.authorized_by_title,
        line_items: reindexLineItems(form.line_items).map(({ key: _key, ...line }) => ({
          ...line,
          product_id: line.product_id?.trim() ? line.product_id.trim() : null,
          quantity: line.quantity != null ? line.quantity : null,
          unit_price: line.unit_price != null ? line.unit_price : null,
        })),
        payment_account_ids: form.payment_account_ids,
      },
      paymentAccounts: initialPaymentAccounts,
      opportunityName: opportunity?.opportunity_name ?? null,
      authorizedBy,
      branding,
      billingSettings,
    });
  }, [
    previewOpen,
    form,
    tenantId,
    displayQuotationNumber,
    isProductQuotation,
    discountType,
    clientOpportunities,
    initialAuthorizedSigners,
    initialPaymentAccounts,
    branding,
    billingSettings,
  ]);

  function handleQuotationTypeChange(nextType: ClientQuotationType) {
    setForm((current) => ({
      ...current,
      quotation_type: nextType,
      tax_basis: defaultTaxBasisForQuotationType(nextType),
      header_discount_amount: nextType === "product" ? current.header_discount_amount ?? 0 : 0,
      discount_type: nextType === "product" ? current.discount_type ?? "flat" : "flat",
      discount_percentage: nextType === "product" ? current.discount_percentage ?? 0 : 0,
      line_items:
        nextType === "product"
          ? [emptyProductQuotationLineItem(0)]
          : [emptyQuotationLineItem(0)],
    }));
  }

  function handlePreview() {
    setPreviewError(null);

    if (!form.client_id.trim()) {
      setPreviewError("Select a customer before previewing.");
      return;
    }

    if (!form.bill_to_name.trim()) {
      setPreviewError("Bill-to name is required before previewing.");
      return;
    }

    if (!form.issue_date) {
      setPreviewError("Issue date is required before previewing.");
      return;
    }

    if (form.line_items.length === 0) {
      setPreviewError("Add at least one line item before previewing.");
      return;
    }

    const hasInvalidLine = form.line_items.some((line) => !line.description.trim());
    if (hasInvalidLine) {
      setPreviewError("Each line item needs a description before previewing.");
      return;
    }

    setPreviewOpen(true);
  }

  function handleClientChange(clientId: string) {
    const customer = initialCustomers.find((entry) => entry.client_id === clientId);
    setForm((current) => ({
      ...current,
      client_id: clientId,
      opportunity_id: "",
      bill_to_name: customer?.client_name ?? "",
      bill_to_address: customer?.address ?? "",
      bill_to_phone: customer?.phone ?? "",
      line_items: current.line_items.filter((line) => !line.site_id),
    }));
  }

  function togglePaymentAccount(paymentAccountId: string) {
    setForm((current) => ({
      ...current,
      payment_account_ids: current.payment_account_ids.includes(paymentAccountId)
        ? current.payment_account_ids.filter((id) => id !== paymentAccountId)
        : [...current.payment_account_ids, paymentAccountId],
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isConverted) {
      return;
    }

    setSaving(true);
    setError(null);

    const authorizedBy = resolveAuthorizedByFields(
      form.authorized_by_selection,
      form.authorized_by_other_name,
      form.authorized_by_other_title,
      initialAuthorizedSigners,
    );

    if (!authorizedBy.authorized_by_name?.trim()) {
      setError("Authorized By is required.");
      setSaving(false);
      return;
    }

    const payload: ClientQuotationWriteBody = {
      client_id: form.client_id,
      opportunity_id: form.opportunity_id?.trim() || null,
      document_type: form.document_type,
      quotation_type: normalizeQuotationType(form.quotation_type),
      tax_basis: resolveQuotationTaxBasis(
        form.tax_basis,
        normalizeQuotationType(form.quotation_type),
      ),
      issue_date: form.issue_date,
      valid_until: form.valid_until || null,
      bill_to_name: form.bill_to_name,
      bill_to_address: form.bill_to_address,
      bill_to_phone: form.bill_to_phone,
      ...resolveShipToPayload(form),
      vat_nhil_getfund_rate: form.vat_nhil_getfund_rate,
      wht_rate: form.wht_rate,
      header_discount_amount: isProductQuotation
        ? form.header_discount_amount ?? 0
        : 0,
      discount_type: isProductQuotation ? discountType : "flat",
      discount_percentage:
        isProductQuotation && discountType === "percentage"
          ? form.discount_percentage ?? 0
          : null,
      status: form.status,
      notes: form.notes,
      commercial_terms: form.commercial_terms?.trim() || null,
      internal_notes: form.internal_notes?.trim() || null,
      payment_terms: normalizeClientQuotationPaymentTerms(form.payment_terms),
      authorized_by_name: authorizedBy.authorized_by_name,
      authorized_by_title: authorizedBy.authorized_by_title,
      line_items: reindexLineItems(form.line_items).map(({ key: _key, ...line }) => ({
        ...line,
        product_id: line.product_id?.trim() ? line.product_id.trim() : null,
        quantity: line.quantity != null ? line.quantity : null,
        unit_price: line.unit_price != null ? line.unit_price : null,
      })),
      payment_account_ids: form.payment_account_ids,
    };

    const response = await fetch(
      mode === "create"
        ? "/api/client-quotations"
        : `/api/client-quotations/${quotationId}`,
      {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    const result = (await response.json().catch(() => null)) as
      | { client_quotation?: { id: string }; error?: string }
      | null;

    if (!response.ok) {
      setError(result?.error ?? "Unable to save quotation.");
      setSaving(false);
      return;
    }

    router.push("/dashboard/sales-crm/quotations");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {previewError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {previewError}
        </p>
      ) : null}

      {isConverted ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This quotation has been converted to an invoice and can no longer be edited.
        </p>
      ) : null}

      {mode === "edit" && !isConverted && quotationHasBeenSent(form.status) ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This quotation has already been sent to the client. Changes here update the record
          only — use the list actions to change status.
        </p>
      ) : null}

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Customer</h3>
          <p className="mt-1 text-xs text-slate-500">
            Select the contract customer. Bill-to details are pre-filled but editable.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Customer *
            </label>
            <select
              required
              disabled={isConverted}
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
              Linked Opportunity
            </label>
            <select
              value={form.opportunity_id ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  opportunity_id: event.target.value,
                }))
              }
              disabled={!form.client_id || clientOpportunities.length === 0 || isConverted}
              className={inputClassName}
            >
              <option value="">None</option>
              {clientOpportunities.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.opportunity_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Bill To Name *
            </label>
            <input
              type="text"
              required
              disabled={isConverted}
              value={form.bill_to_name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  bill_to_name: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Bill To Phone
            </label>
            <input
              type="text"
              disabled={isConverted}
              value={form.bill_to_phone ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  bill_to_phone: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Bill To Address
            </label>
            <textarea
              rows={3}
              disabled={isConverted}
              value={form.bill_to_address ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  bill_to_address: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
        </div>

        <div className="space-y-4 border-t border-slate-200 pt-4">
          <div>
            <h4 className="text-sm font-medium text-slate-700">Ship To</h4>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                disabled={isConverted}
                checked={form.ship_to_same_as_billing}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    ship_to_same_as_billing: event.target.checked,
                  }))
                }
                className="rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
              />
              Same as billing
            </label>
          </div>

          {!form.ship_to_same_as_billing ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Ship To Name
                </label>
                <input
                  type="text"
                  disabled={isConverted}
                  value={form.ship_to_name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      ship_to_name: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Ship To Phone
                </label>
                <input
                  type="text"
                  disabled={isConverted}
                  value={form.ship_to_phone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      ship_to_phone: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Ship To Address
                </label>
                <textarea
                  rows={3}
                  disabled={isConverted}
                  value={form.ship_to_address}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      ship_to_address: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Quotation Details</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Quotation Number
            </label>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-[#0f2744]">
              {displayQuotationNumber || "—"}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {mode === "create"
                ? "Assigned automatically when you save."
                : "Quotation number cannot be changed after creation."}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Document Type
            </label>
            <select
              disabled={isConverted}
              value={form.document_type ?? "quotation"}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  document_type: event.target.value as ClientQuotationDocumentType,
                }))
              }
              className={inputClassName}
            >
              <option value="quotation">Quotation</option>
              <option value="proforma_invoice">Pro-forma Invoice</option>
            </select>
          </div>
          {mode === "edit" ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Status
              </label>
              <select
                disabled={isConverted}
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as ClientQuotationStatus,
                  }))
                }
                className={inputClassName}
              >
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="accepted">Accepted</option>
                <option value="declined">Declined</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Issue Date *
            </label>
            <input
              type="date"
              required
              disabled={isConverted}
              value={form.issue_date}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  issue_date: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Valid Until
            </label>
            <input
              type="date"
              disabled={isConverted}
              value={form.valid_until ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  valid_until: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Payment Terms
            </label>
            <select
              disabled={isConverted}
              value={normalizeClientQuotationPaymentTerms(form.payment_terms)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  payment_terms: event.target.value,
                }))
              }
              className={inputClassName}
            >
              {CLIENT_QUOTATION_PAYMENT_TERMS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Shown on the printed quotation near the validity notice.
            </p>
          </div>
        </div>
      </section>

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Quotation Type</h3>
          <p className="mt-1 text-xs text-slate-500">
            Service quotations use labour/material line items. Product quotations use
            finished products with optional manual lines.
          </p>
        </div>
        <div className="max-w-md">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Quotation Type
          </label>
          <select
            disabled={isConverted}
            value={form.quotation_type ?? "service"}
            onChange={(event) =>
              handleQuotationTypeChange(event.target.value as ClientQuotationType)
            }
            className={inputClassName}
          >
            <option value="service">Service Quotation</option>
            <option value="product">Product Quotation</option>
          </select>
        </div>
      </section>

      <LineItemsEditor
        lineItems={form.line_items}
        onLineItemsChange={(line_items) => setForm((current) => ({ ...current, line_items }))}
        itemSource={isProductQuotation ? "product" : "site"}
        siteOptions={clientSites}
        products={initialProducts}
        clientSelected={Boolean(form.client_id)}
        vatRate={form.vat_nhil_getfund_rate ?? 0}
        whtRate={form.wht_rate ?? 0}
        taxBasis={resolveQuotationTaxBasis(
          form.tax_basis,
          normalizeQuotationType(form.quotation_type),
        )}
        disabled={isConverted}
        sectionDescription={
          isProductQuotation
            ? "Add products from inventory or manual ad-hoc lines."
            : "Group lines with the same category label. Total cost updates live."
        }
        showCurrencyInHeaders={!isProductQuotation}
        createManualLine={emptyQuotationLineItem}
        createProductLine={isProductQuotation ? emptyProductQuotationLineItem : undefined}
      />

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Payment Accounts</h3>
          <p className="mt-1 text-xs text-slate-500">
            Choose one or more active payment profiles to show on this quotation.
          </p>
        </div>
        {initialPaymentAccounts.length === 0 ? (
          <p className="text-sm text-slate-500">
            No active payment accounts configured yet.
          </p>
        ) : (
          <div className="space-y-3">
            {initialPaymentAccounts.map((account) => (
              <label
                key={account.id}
                className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3"
              >
                <input
                  type="checkbox"
                  disabled={isConverted}
                  checked={form.payment_account_ids.includes(account.id)}
                  onChange={() => togglePaymentAccount(account.id)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0f2744]"
                />
                <span>
                  <span className="block text-sm font-medium text-[#0f2744]">
                    {account.account_name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {[account.bank_name, account.bank_account_number, account.momo_provider, account.momo_number]
                      .filter(Boolean)
                      .join(" · ") || "No payment details yet"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Authorized By</h3>
          <p className="mt-1 text-xs text-slate-500">
            Required. Name and title print on the quotation; the workspace signature
            image is shown when configured.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Authorized By <span className="text-red-600">*</span>
            </label>
            <select
              disabled={isConverted}
              required
              value={form.authorized_by_selection}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  authorized_by_selection: event.target.value,
                }))
              }
              className={inputClassName}
            >
              <option value="">Select authorized by…</option>
              {initialAuthorizedSigners.map((signer) => (
                <option key={signer.employee_id} value={signer.employee_id}>
                  {formatAuthorizedSignerLabel(signer)}
                </option>
              ))}
              <option value={AUTHORIZED_BY_OTHER}>Other</option>
            </select>
          </div>
          {form.authorized_by_selection === AUTHORIZED_BY_OTHER ? (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  disabled={isConverted}
                  required
                  value={form.authorized_by_other_name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      authorized_by_other_name: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Title/Role
                </label>
                <input
                  type="text"
                  disabled={isConverted}
                  value={form.authorized_by_other_title}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      authorized_by_other_title: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
            </>
          ) : null}
        </div>
      </section>

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Totals</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              VAT/NHIL/GETFund Rate (%)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              disabled={isConverted}
              value={form.vat_nhil_getfund_rate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  vat_nhil_getfund_rate: Number(event.target.value) || 0,
                }))
              }
              className={inputClassName}
            />
            <p className="mt-1 text-xs text-slate-500">Standard rate: 20%</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              WHT Rate (%)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              disabled={isConverted}
              value={form.wht_rate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  wht_rate: Number(event.target.value) || 0,
                }))
              }
              className={inputClassName}
            />
            <p className="mt-1 text-xs text-slate-500">Standard rate: 7.5%</p>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              VAT/WHT Calculation Basis
            </label>
            <select
              disabled={isConverted}
              value={
                resolveQuotationTaxBasis(
                  form.tax_basis,
                  normalizeQuotationType(form.quotation_type),
                )
              }
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  tax_basis: resolveQuotationTaxBasis(
                    event.target.value,
                    normalizeQuotationType(current.quotation_type),
                  ),
                }))
              }
              className={inputClassName}
            >
              {QUOTATION_TAX_BASIS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {isProductQuotation ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Header Discount
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isConverted}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      discount_type: "flat" as ClientQuotationDiscountType,
                    }))
                  }
                  className={
                    discountType === "flat"
                      ? primaryButtonClassName
                      : secondaryButtonClassName
                  }
                >
                  Flat (GHS)
                </button>
                <button
                  type="button"
                  disabled={isConverted}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      discount_type: "percentage" as ClientQuotationDiscountType,
                    }))
                  }
                  className={
                    discountType === "percentage"
                      ? primaryButtonClassName
                      : secondaryButtonClassName
                  }
                >
                  Percentage (%)
                </button>
              </div>
            </div>
            {discountType === "percentage" ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Header Discount (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  disabled={isConverted}
                  value={form.discount_percentage ?? 0}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      discount_percentage: Number(event.target.value) || 0,
                    }))
                  }
                  className={inputClassName}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Optional quote-level percentage discount applied after line totals.
                </p>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Header Discount (GHS)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={isConverted}
                  value={form.header_discount_amount ?? 0}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      header_discount_amount: Number(event.target.value) || 0,
                    }))
                  }
                  className={inputClassName}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Optional quote-level discount applied after line totals.
                </p>
              </div>
            )}
          </div>
        ) : null}
        <dl className="grid gap-3 md:grid-cols-2">
          {isProductQuotation && totals.header_discount_amount > 0 ? (
            <div className="rounded-md bg-slate-50 px-4 py-3 md:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Line Subtotal
              </dt>
              <dd className="text-lg font-semibold text-[#0f2744]">
                {formatInvoiceMoney(totals.line_subtotal)}
              </dd>
            </div>
          ) : null}
          {isProductQuotation && totals.header_discount_amount > 0 ? (
            <div className="rounded-md bg-slate-50 px-4 py-3 md:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Header Discount
              </dt>
              <dd className="text-lg font-semibold text-red-700">
                {discountType === "percentage" && headerDiscountPreviewLabel
                  ? `${headerDiscountPreviewLabel} (−${formatInvoiceMoney(totals.header_discount_amount)})`
                  : `−${formatInvoiceMoney(totals.header_discount_amount)}`}
              </dd>
            </div>
          ) : null}
          <div className="rounded-md bg-slate-50 px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Subtotal</dt>
            <dd className="text-lg font-semibold text-[#0f2744]">
              {formatInvoiceMoney(totals.subtotal)}
            </dd>
          </div>
          <div className="rounded-md bg-slate-50 px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              VAT/NHIL/GETFund
            </dt>
            <dd className="text-lg font-semibold text-[#0f2744]">
              {formatInvoiceMoney(totals.tax_due)}
            </dd>
          </div>
          <div className="rounded-md bg-slate-50 px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              WHT (not deducted)
            </dt>
            <dd className="text-lg font-semibold text-slate-700">
              {formatInvoiceMoney(totals.wht_amount)}
            </dd>
          </div>
          <div className="rounded-md bg-[#0f2744] px-4 py-3 text-white md:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-slate-200">
              Total Amount Due
            </dt>
            <dd className="text-lg font-semibold">
              {formatInvoiceMoney(totals.total_amount_due)}
            </dd>
          </div>
        </dl>
      </section>

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Internal Notes</h3>
          <p className="mt-1 text-xs text-slate-500">
            Staff-only notes for your team. Never shown on the printed quotation or client portal.
          </p>
        </div>
        <textarea
          rows={4}
          disabled={isConverted}
          value={form.internal_notes ?? ""}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              internal_notes: event.target.value,
            }))
          }
          placeholder="Follow-up reminders, pricing rationale, approval notes…"
          className={inputClassName}
        />
      </section>

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Commercial Terms</h3>
          <p className="mt-1 text-xs text-slate-500">
            Optional footnote shown below the signature block on the printed document.
          </p>
        </div>
        <textarea
          rows={4}
          disabled={isConverted}
          value={form.commercial_terms ?? ""}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              commercial_terms: event.target.value,
            }))
          }
          placeholder="Payment terms, delivery conditions, or other commercial notes…"
          className={inputClassName}
        />
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving || isConverted}
          className={primaryButtonClassName}
        >
          {saving
            ? "Saving…"
            : mode === "create"
              ? "Save Quotation"
              : "Update Quotation"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={handlePreview}
          className={secondaryButtonClassName}
        >
          Preview
        </button>
        <Link
          href="/dashboard/sales-crm/quotations"
          className={secondaryButtonClassName}
        >
          Cancel
        </Link>
      </div>

      <ClientQuotationPreviewDialog
        open={previewOpen}
        display={previewDisplay}
        onClose={() => setPreviewOpen(false)}
      />
    </form>
  );
}
