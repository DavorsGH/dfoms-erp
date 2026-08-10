"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientEntry } from "@/app/dashboard/operations/clients-utils";
import type { SalesTaxBasis } from "@/app/dashboard/finance/tax-utils";
import { formatAuthorizedSignerLabel } from "@/utils/client-invoices-types";
import type { PaymentAccountRow } from "@/utils/payment-accounts-types";
import {
  AUTHORIZED_BY_OTHER,
  computeLineTotalCost,
  computeQuotationTotals,
  emptyQuotationLineItem,
  formatInvoiceMoney,
  resolveAuthorizedByFields,
  type ClientInvoiceAuthorizedSignerOption,
  type ClientInvoiceFormAuthorizedByState,
  type ClientQuotationDocumentType,
  type ClientQuotationFormLineItem,
  type ClientQuotationPipelineOpportunityOption,
  type ClientQuotationSiteOption,
  type ClientQuotationStatus,
  type ClientQuotationWriteBody,
} from "@/utils/client-quotations-types";

type ClientQuotationFormState = Omit<ClientQuotationWriteBody, "line_items"> &
  ClientInvoiceFormAuthorizedByState & {
    line_items: ClientQuotationFormLineItem[];
  };

type ClientQuotationFormProps = {
  mode: "create" | "edit";
  quotationId?: string;
  /** Non-allocating preview of the next server-assigned quotation number. */
  nextQuotationNumberPreview?: string | null;
  existingQuotationNumber?: string;
  isConverted?: boolean;
  initialCustomers: ClientEntry[];
  initialOpportunities: ClientQuotationPipelineOpportunityOption[];
  initialSites: ClientQuotationSiteOption[];
  initialPaymentAccounts: PaymentAccountRow[];
  initialAuthorizedSigners: ClientInvoiceAuthorizedSignerOption[];
  initialForm: ClientQuotationFormState;
  salesTaxBasis: SalesTaxBasis;
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

export default function ClientQuotationForm({
  mode,
  quotationId,
  nextQuotationNumberPreview,
  existingQuotationNumber,
  isConverted = false,
  initialCustomers,
  initialOpportunities,
  initialSites,
  initialPaymentAccounts,
  initialAuthorizedSigners,
  initialForm,
  salesTaxBasis,
  fetchError = null,
}: ClientQuotationFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<ClientQuotationFormState>(initialForm);
  const [error, setError] = useState<string | null>(fetchError);
  const [saving, setSaving] = useState(false);
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

  const totals = useMemo(
    () =>
      computeQuotationTotals(
        form.line_items,
        form.vat_nhil_getfund_rate,
        form.wht_rate,
        salesTaxBasis,
      ),
    [form.line_items, form.vat_nhil_getfund_rate, form.wht_rate, salesTaxBasis],
  );

  const displayQuotationNumber = useMemo(() => {
    if (mode === "edit") {
      return existingQuotationNumber ?? "";
    }

    return nextQuotationNumberPreview?.trim() || "Assigned on save";
  }, [mode, existingQuotationNumber, nextQuotationNumberPreview]);

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
      issue_date: form.issue_date,
      valid_until: form.valid_until || null,
      bill_to_name: form.bill_to_name,
      bill_to_address: form.bill_to_address,
      bill_to_phone: form.bill_to_phone,
      vat_nhil_getfund_rate: form.vat_nhil_getfund_rate,
      wht_rate: form.wht_rate,
      status: form.status,
      notes: form.notes,
      authorized_by_name: authorizedBy.authorized_by_name,
      authorized_by_title: authorizedBy.authorized_by_title,
      line_items: reindexLineItems(form.line_items).map(({ key: _key, ...line }) => line),
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
        </div>
      </section>

      <section className={cardClassName}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-sm font-medium text-slate-700">Line Items</h3>
            <p className="mt-1 text-xs text-slate-500">
              Group lines with the same category label. Total cost updates live.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
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
                      {formatInvoiceMoney(computeLineTotalCost(line))}
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
        </div>
        <dl className="grid gap-3 md:grid-cols-2">
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
        <Link
          href="/dashboard/sales-crm/quotations"
          className={secondaryButtonClassName}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
