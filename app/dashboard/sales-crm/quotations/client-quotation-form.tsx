"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTenantBranding } from "@/app/dashboard/tenant-branding-context";
import type { BillingSettingsHeaderFields } from "@/utils/billing-settings-types";
import type { ClientEntry } from "@/app/dashboard/operations/clients-utils";
import type { FinishedProductRecord } from "@/app/dashboard/inventory/finished-products-utils";
import { formatAuthorizedSignerLabel } from "@/utils/client-invoices-types";
import type { PaymentAccountRow } from "@/utils/payment-accounts-types";
import {
  AUTHORIZED_BY_OTHER,
  CLIENT_QUOTATION_PAYMENT_TERMS_OPTIONS,
  computeQuotationLineTotalCost,
  computeQuotationTotals,
  defaultTaxBasisForQuotationType,
  emptyProductQuotationLineItem,
  emptyQuotationLineItem,
  formatInvoiceMoney,
  isProductCatalogLine,
  isProductPickerLine,
  normalizeClientQuotationPaymentTerms,
  normalizeQuotationDiscountType,
  normalizeQuotationType,
  quotationHeaderDiscountLabel,
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

function reindexLineItems(lines: ClientQuotationFormLineItem[]) {
  return lines.map((line, index) => ({ ...line, sort_order: index }));
}

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
  const [sitePicker, setSitePicker] = useState("");

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

  function updateLineItem(key: string, patch: Partial<ClientQuotationFormLineItem>) {
    setForm((current) => ({
      ...current,
      line_items: current.line_items.map((line) =>
        line.key === key ? { ...line, ...patch } : line,
      ),
    }));
  }

  function moveLineItem(key: string, direction: -1 | 1) {
    setForm((current) => {
      const index = current.line_items.findIndex((line) => line.key === key);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.line_items.length) {
        return current;
      }

      const next = [...current.line_items];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return { ...current, line_items: reindexLineItems(next) };
    });
  }

  function removeLineItem(key: string) {
    setForm((current) => ({
      ...current,
      line_items: reindexLineItems(
        current.line_items.filter((line) => line.key !== key),
      ),
    }));
  }

  function addManualLine() {
    setForm((current) => ({
      ...current,
      line_items: reindexLineItems([
        ...current.line_items,
        emptyQuotationLineItem(current.line_items.length),
      ]),
    }));
  }

  function addProductLine() {
    setForm((current) => ({
      ...current,
      line_items: reindexLineItems([
        ...current.line_items,
        emptyProductQuotationLineItem(current.line_items.length),
      ]),
    }));
  }

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
    setSitePicker("");
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

  function updateProductLine(
    key: string,
    patch: Partial<ClientQuotationFormLineItem>,
  ) {
    setForm((current) => ({
      ...current,
      line_items: current.line_items.map((line) => {
        if (line.key !== key) {
          return line;
        }

        const nextLine = { ...line, ...patch };

        if (patch.product_id !== undefined) {
          const product = initialProducts.find(
            (entry) => entry.id === patch.product_id,
          );
          if (product) {
            nextLine.description = `${product.product_code} — ${product.product_name}`;
            if (!nextLine.unit_price) {
              nextLine.unit_price = toNumber(product.standard_selling_price);
            }
          } else if (!patch.product_id) {
            nextLine.description = "";
          }
        }

        return nextLine;
      }),
    }));
  }

  function toNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function addSiteLine(siteCode: string) {
    const site = clientSites.find((entry) => entry.site_code === siteCode);
    if (!site) {
      return;
    }

    setForm((current) => ({
      ...current,
      line_items: reindexLineItems([
        ...current.line_items,
        {
          ...emptyQuotationLineItem(current.line_items.length),
          site_id: site.site_code,
          description: site.site_name,
        },
      ]),
    }));
    setSitePicker("");
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
    setSitePicker("");
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

      <section className={cardClassName}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-sm font-medium text-slate-700">Line Items</h3>
            <p className="mt-1 text-xs text-slate-500">
              {isProductQuotation
                ? "Add products from inventory or manual ad-hoc lines."
                : "Group lines with the same category label. Total cost updates live."}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {!isProductQuotation ? (
              <div className="flex gap-2">
                <select
                  value={sitePicker}
                  disabled={isConverted || !form.client_id}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value) {
                      addSiteLine(value);
                    }
                  }}
                  className={inputClassName}
                >
                  <option value="">
                    {!form.client_id
                      ? "Select customer first"
                      : clientSites.length === 0
                        ? "No sites for this customer"
                        : "Add site line…"}
                  </option>
                  {clientSites.map((site) => (
                    <option key={site.site_code} value={site.site_code}>
                      {site.site_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {isProductQuotation ? (
              <button
                type="button"
                disabled={isConverted}
                onClick={addProductLine}
                className={secondaryButtonClassName}
              >
                Add Product Line
              </button>
            ) : null}
            <button
              type="button"
              disabled={isConverted}
              onClick={addManualLine}
              className={secondaryButtonClassName}
            >
              Add Manual Line
            </button>
          </div>
        </div>

        {form.line_items.length === 0 ? (
          <p className="text-sm text-slate-500">No line items yet.</p>
        ) : isProductQuotation ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Product / Description</th>
                  <th className="px-3 py-2">Quantity</th>
                  <th className="px-3 py-2">Unit Price (GHS)</th>
                  <th className="px-3 py-2">Discount</th>
                  <th className="px-3 py-2">Taxed</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {form.line_items.map((line) => {
                  const productPickerLine = isProductPickerLine(line);
                  const quotationType = normalizeQuotationType(form.quotation_type);

                  return (
                    <tr key={line.key}>
                      <td className="px-3 py-2 text-slate-600">
                        {productPickerLine ? "Product" : "Manual"}
                      </td>
                      <td className="px-3 py-2">
                        {productPickerLine ? (
                          <select
                            required
                            disabled={isConverted}
                            value={line.product_id ?? ""}
                            onChange={(event) =>
                              updateProductLine(line.key, {
                                product_id: event.target.value,
                              })
                            }
                            className={inputClassName}
                          >
                            <option value="">Select product</option>
                            {initialProducts.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.product_code} — {product.product_name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            required
                            disabled={isConverted}
                            value={line.description}
                            onChange={(event) =>
                              updateLineItem(line.key, {
                                description: event.target.value,
                              })
                            }
                            className={inputClassName}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {productPickerLine ? (
                          <input
                            type="number"
                            min="0.0001"
                            step="0.0001"
                            disabled={isConverted}
                            value={line.quantity ?? 1}
                            onChange={(event) =>
                              updateProductLine(line.key, {
                                quantity: Number(event.target.value) || 0,
                              })
                            }
                            className={inputClassName}
                          />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {productPickerLine ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={isConverted}
                            value={line.unit_price ?? 0}
                            onChange={(event) =>
                              updateProductLine(line.key, {
                                unit_price: Number(event.target.value) || 0,
                              })
                            }
                            className={inputClassName}
                          />
                        ) : (
                          <div className="grid gap-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              disabled={isConverted}
                              placeholder="Service cost"
                              value={line.labour_amount}
                              onChange={(event) =>
                                updateLineItem(line.key, {
                                  labour_amount: Number(event.target.value) || 0,
                                })
                              }
                              className={inputClassName}
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              disabled={isConverted}
                              placeholder="Material cost"
                              value={line.material_amount}
                              onChange={(event) =>
                                updateLineItem(line.key, {
                                  material_amount: Number(event.target.value) || 0,
                                })
                              }
                              className={inputClassName}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={isConverted}
                          value={line.discount_amount}
                          onChange={(event) =>
                            (productPickerLine ? updateProductLine : updateLineItem)(line.key, {
                              discount_amount: Number(event.target.value) || 0,
                            })
                          }
                          className={inputClassName}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          disabled={isConverted}
                          checked={line.taxed}
                          onChange={(event) =>
                            (productPickerLine ? updateProductLine : updateLineItem)(line.key, {
                              taxed: event.target.checked,
                            })
                          }
                          className="h-4 w-4 rounded border-slate-300 text-[#0f2744]"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-[#0f2744]">
                        {formatInvoiceMoney(
                          computeQuotationLineTotalCost(line, quotationType),
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={isConverted}
                            onClick={() => moveLineItem(line.key, -1)}
                            className={secondaryButtonClassName}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            disabled={isConverted}
                            onClick={() => moveLineItem(line.key, 1)}
                            className={secondaryButtonClassName}
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            disabled={isConverted}
                            onClick={() => removeLineItem(line.key)}
                            className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Service Cost (GHS)</th>
                  <th className="px-3 py-2">Material Cost (GHS)</th>
                  <th className="px-3 py-2">Discount</th>
                  <th className="px-3 py-2">Taxed</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {form.line_items.map((line) => (
                  <tr key={line.key}>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        required
                        disabled={isConverted}
                        value={line.description}
                        onChange={(event) =>
                          updateLineItem(line.key, {
                            description: event.target.value,
                          })
                        }
                        className={inputClassName}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        disabled={isConverted}
                        value={line.category_label ?? ""}
                        onChange={(event) =>
                          updateLineItem(line.key, {
                            category_label: event.target.value,
                          })
                        }
                        className={inputClassName}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={isConverted}
                        value={line.labour_amount}
                        onChange={(event) =>
                          updateLineItem(line.key, {
                            labour_amount: Number(event.target.value) || 0,
                          })
                        }
                        className={inputClassName}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={isConverted}
                        value={line.material_amount}
                        onChange={(event) =>
                          updateLineItem(line.key, {
                            material_amount: Number(event.target.value) || 0,
                          })
                        }
                        className={inputClassName}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={isConverted}
                        value={line.discount_amount}
                        onChange={(event) =>
                          updateLineItem(line.key, {
                            discount_amount: Number(event.target.value) || 0,
                          })
                        }
                        className={inputClassName}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        disabled={isConverted}
                        checked={line.taxed}
                        onChange={(event) =>
                          updateLineItem(line.key, {
                            taxed: event.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-slate-300 text-[#0f2744]"
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-[#0f2744]">
                      {formatInvoiceMoney(
                        computeQuotationLineTotalCost(
                          line,
                          normalizeQuotationType(form.quotation_type),
                        ),
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={isConverted}
                          onClick={() => moveLineItem(line.key, -1)}
                          className={secondaryButtonClassName}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          disabled={isConverted}
                          onClick={() => moveLineItem(line.key, 1)}
                          className={secondaryButtonClassName}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          disabled={isConverted}
                          onClick={() => removeLineItem(line.key)}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
            Optional signature block shown on the printed quotation.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Authorized By
            </label>
            <select
              disabled={isConverted}
              value={form.authorized_by_selection}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  authorized_by_selection: event.target.value,
                }))
              }
              className={inputClassName}
            >
              <option value="">None</option>
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
                  Name
                </label>
                <input
                  type="text"
                  disabled={isConverted}
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
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              WHT Rate (%) — display only
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
