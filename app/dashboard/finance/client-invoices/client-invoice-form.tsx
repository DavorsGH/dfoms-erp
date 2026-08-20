"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import LineItemsEditor, { reindexLineItems } from "@/components/line-items-editor";
import PromoCodeField from "@/components/promo-code-field";
import type { ClientEntry } from "@/app/dashboard/operations/clients-utils";
import type { SalesTaxBasis } from "@/app/dashboard/finance/tax-utils";
import {
  AUTHORIZED_BY_OTHER,
  computeInvoiceTotals,
  computeLineTotalCost,
  defaultDueDate,
  emptyLineItem,
  formatAuthorizedSignerLabel,
  formatInvoiceMoney,
  invoiceHasBeenSent,
  resolveAuthorizedByFields,
  roundMoney,
  toNumber,
  type ClientInvoiceAuthorizedSignerOption,
  type ClientInvoiceFormAuthorizedByState,
  type ClientInvoiceFormLineItem,
  type ClientInvoiceSiteOption,
  type ClientInvoiceStatus,
  type ClientInvoiceWriteBody,
} from "@/utils/client-invoices-types";
import type { PaymentAccountRow } from "@/utils/payment-accounts-types";
import type { ServiceContractOption } from "@/utils/service-contracts-types";

type ClientInvoiceFormState = Omit<ClientInvoiceWriteBody, "line_items"> &
  ClientInvoiceFormAuthorizedByState & {
    line_items: ClientInvoiceFormLineItem[];
  };

type ClientInvoiceFormProps = {
  mode: "create" | "edit";
  invoiceId?: string;
  /** Non-allocating preview of the next server-assigned invoice number (e.g. DF-INV-0001). */
  nextInvoiceNumberPreview?: string | null;
  existingInvoiceNumber?: string;
  initialCustomers: ClientEntry[];
  initialSites: ClientInvoiceSiteOption[];
  initialPaymentAccounts: PaymentAccountRow[];
  initialAuthorizedSigners: ClientInvoiceAuthorizedSignerOption[];
  initialServiceContracts?: ServiceContractOption[];
  initialForm: ClientInvoiceFormState;
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

export default function ClientInvoiceForm({
  mode,
  invoiceId,
  nextInvoiceNumberPreview,
  existingInvoiceNumber,
  initialCustomers,
  initialSites,
  initialPaymentAccounts,
  initialAuthorizedSigners,
  initialServiceContracts = [],
  initialForm,
  salesTaxBasis,
  fetchError = null,
}: ClientInvoiceFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<ClientInvoiceFormState>(initialForm);
  const [error, setError] = useState<string | null>(fetchError);
  const [saving, setSaving] = useState(false);
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);

  const clientSites = useMemo(
    () =>
      form.client_id
        ? initialSites.filter((site) => site.client_id === form.client_id)
        : [],
    [form.client_id, initialSites],
  );

  const clientContracts = useMemo(
    () =>
      form.client_id
        ? initialServiceContracts.filter(
            (contract) => contract.client_id === form.client_id,
          )
        : [],
    [form.client_id, initialServiceContracts],
  );

  const totals = useMemo(
    () =>
      computeInvoiceTotals(
        form.line_items,
        form.vat_nhil_getfund_rate,
        form.wht_rate,
        salesTaxBasis,
      ),
    [form.line_items, form.vat_nhil_getfund_rate, form.wht_rate, salesTaxBasis],
  );

  const invoiceTotalDue = useMemo(
    () => roundMoney(Math.max(0, totals.total_amount_due - promoDiscount)),
    [totals.total_amount_due, promoDiscount],
  );

  const displayInvoiceNumber = useMemo(() => {
    if (mode === "edit") {
      return existingInvoiceNumber ?? "";
    }

    return nextInvoiceNumberPreview?.trim() || "Assigned on save";
  }, [mode, existingInvoiceNumber, nextInvoiceNumberPreview]);

  function handleClientChange(clientId: string) {
    const customer = initialCustomers.find((entry) => entry.client_id === clientId);
    setForm((current) => ({
      ...current,
      client_id: clientId,
      contract_id: "",
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
    setSaving(true);
    setError(null);

    const authorizedBy = resolveAuthorizedByFields(
      form.authorized_by_selection,
      form.authorized_by_other_name,
      form.authorized_by_other_title,
      initialAuthorizedSigners,
    );

    const payload: ClientInvoiceWriteBody = {
      client_id: form.client_id,
      contract_id: form.contract_id?.trim() ? form.contract_id : null,
      invoice_date: form.invoice_date,
      due_date: form.due_date,
      billing_period_start: form.billing_period_start || null,
      billing_period_end: form.billing_period_end || null,
      bill_to_name: form.bill_to_name,
      bill_to_address: form.bill_to_address,
      bill_to_phone: form.bill_to_phone,
      vat_nhil_getfund_rate: form.vat_nhil_getfund_rate,
      wht_rate: form.wht_rate,
      status: form.status,
      amount_received: form.amount_received ?? 0,
      notes: form.notes,
      authorized_by_name: authorizedBy.authorized_by_name,
      authorized_by_title: authorizedBy.authorized_by_title,
      line_items: reindexLineItems(form.line_items).map(({ key: _key, ...line }, index) =>
        index === 0 && promoDiscount > 0
          ? {
              ...line,
              discount_amount: roundMoney(
                toNumber(line.discount_amount) + promoDiscount,
              ),
              total_cost: roundMoney(
                computeLineTotalCost({
                  ...line,
                  discount_amount: roundMoney(
                    toNumber(line.discount_amount) + promoDiscount,
                  ),
                }),
              ),
            }
          : line,
      ),
      payment_account_ids: form.payment_account_ids,
    };

    const response = await fetch(
      mode === "create" ? "/api/client-invoices" : `/api/client-invoices/${invoiceId}`,
      {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    const result = (await response.json().catch(() => null)) as
      | { client_invoice?: { id: string }; error?: string }
      | null;

    if (!response.ok) {
      setError(result?.error ?? "Unable to save invoice.");
      setSaving(false);
      return;
    }

    router.push("/dashboard/finance/client-invoices");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {mode === "edit" && invoiceHasBeenSent(form.status) ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This invoice has already been sent to the client. Changes here update the record
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
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Service Contract
            </label>
            <select
              value={form.contract_id ?? ""}
              disabled={!form.client_id}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contract_id: event.target.value,
                }))
              }
              className={inputClassName}
            >
              <option value="">
                {form.client_id ? "No linked contract" : "Select customer first"}
              </option>
              {clientContracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.contract_number}
                </option>
              ))}
            </select>
            {form.contract_id ? (
              <p className="mt-1 text-xs text-slate-500">
                <Link
                  href={`/dashboard/finance/service-contracts/${form.contract_id}`}
                  className="text-[#0f2744] underline"
                >
                  View linked contract
                </Link>
              </p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Bill To Name *
            </label>
            <input
              type="text"
              required
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
          <h3 className="text-sm font-medium text-slate-700">Invoice Details</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Invoice Number
            </label>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-[#0f2744]">
              {displayInvoiceNumber || "—"}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {mode === "create"
                ? "Assigned automatically when you save."
                : "Invoice number cannot be changed after creation."}
            </p>
          </div>
          {mode === "edit" ? (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as ClientInvoiceStatus,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="partial">Partial</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
              {form.status === "partial" && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Amount Received *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={form.amount_received ?? 0}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        amount_received: Number(event.target.value),
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
              )}
            </>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Invoice Date *
            </label>
            <input
              type="date"
              required
              value={form.invoice_date}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  invoice_date: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Due Date
            </label>
            <input
              type="date"
              value={form.due_date ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  due_date: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Billing Period Start
            </label>
            <input
              type="date"
              value={form.billing_period_start ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  billing_period_start: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Billing Period End
            </label>
            <input
              type="date"
              value={form.billing_period_end ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  billing_period_end: event.target.value,
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
        itemSource="site"
        siteOptions={clientSites}
        clientSelected={Boolean(form.client_id)}
        vatRate={form.vat_nhil_getfund_rate ?? 0}
        whtRate={form.wht_rate ?? 0}
        taxBasis={salesTaxBasis}
        disabled={saving}
        sectionDescription="Group lines with the same category label. Total cost updates live."
        showCurrencyInHeaders
        createManualLine={emptyLineItem}
      />

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Payment Accounts</h3>
          <p className="mt-1 text-xs text-slate-500">
            Choose one or more active payment profiles to show on this invoice.
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
            Optional signature block shown on the printed invoice.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Authorized By
            </label>
            <select
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
        </div>
        <PromoCodeField
          supabase={supabase}
          clientId={form.client_id.trim() || null}
          orderAmount={totals.subtotal}
          sourceType="invoice"
          sourceReference={invoiceId ?? null}
          appliedCode={appliedPromoCode}
          appliedDiscount={promoDiscount}
          onApplied={(code, discountAmount) => {
            setAppliedPromoCode(code);
            setPromoDiscount(discountAmount);
          }}
          onClear={() => {
            setAppliedPromoCode(null);
            setPromoDiscount(0);
          }}
          disabled={saving || totals.subtotal <= 0}
        />
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
          <div className="rounded-md bg-slate-50 px-4 py-3 md:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Promo Discount
            </dt>
            <dd className="text-lg font-semibold text-emerald-800">
              {promoDiscount > 0
                ? `-${formatInvoiceMoney(promoDiscount)} (${appliedPromoCode})`
                : formatInvoiceMoney(0)}
            </dd>
          </div>
          <div className="rounded-md bg-[#0f2744] px-4 py-3 text-white md:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-slate-200">
              Total Amount Due
            </dt>
            <dd className="text-lg font-semibold">
              {formatInvoiceMoney(invoiceTotalDue)}
            </dd>
          </div>
        </dl>
      </section>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className={primaryButtonClassName}>
          {saving ? "Saving…" : mode === "create" ? "Save Invoice" : "Update Invoice"}
        </button>
        <Link href="/dashboard/finance/client-invoices" className={secondaryButtonClassName}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
