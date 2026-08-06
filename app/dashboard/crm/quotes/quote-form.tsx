"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import PromoCodeField from "@/components/promo-code-field";
import type { ClientEntry } from "@/app/dashboard/operations/clients-utils";
import type { FinishedProductRecord } from "@/app/dashboard/inventory/finished-products-utils";
import {
  computeProductLineTotal,
  computeQuoteTotals,
  computeServiceLineTotal,
  emptyProductQuoteLine,
  emptyQuoteForm,
  emptyServiceQuoteLine,
  formatQuoteMoney,
  productLineToRpcInput,
  serviceLineToRpcInput,
  type ProductQuoteFormLineItem,
  type QuoteFormState,
  type QuoteType,
  type SalesQuoteSiteOption,
} from "@/utils/sales-quotes-types";
import { groupLineItemsByCategory, roundMoney } from "@/utils/client-invoices-types";

type PipelineOpportunityOption = {
  id: string;
  opportunity_name: string;
  client_id: string;
};

type QuoteFormProps = {
  mode: "create" | "edit";
  quoteId?: string;
  initialCustomers: ClientEntry[];
  initialSites: SalesQuoteSiteOption[];
  initialProducts: FinishedProductRecord[];
  initialOpportunities: PipelineOpportunityOption[];
  initialForm: QuoteFormState;
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

function reindexServiceLines(lines: ServiceQuoteFormLineItem[]) {
  return lines.map((line, index) => ({ ...line, sort_order: index }));
}

function reindexProductLines(lines: ProductQuoteFormLineItem[]) {
  return lines.map((line, index) => ({ ...line, sort_order: index }));
}

type ServiceQuoteFormLineItem = QuoteFormState["service_line_items"][number];

export default function QuoteForm({
  mode,
  quoteId,
  initialCustomers,
  initialSites,
  initialProducts,
  initialOpportunities,
  initialForm,
  fetchError = null,
}: QuoteFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<QuoteFormState>(initialForm);
  const [error, setError] = useState<string | null>(fetchError);
  const [saving, setSaving] = useState(false);
  const [sitePicker, setSitePicker] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);

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
      computeQuoteTotals(
        form.quote_type,
        form.service_line_items,
        form.product_line_items,
      ),
    [form.quote_type, form.service_line_items, form.product_line_items],
  );

  const quoteTotal = useMemo(
    () => roundMoney(Math.max(0, totals.subtotal - promoDiscount)),
    [totals.subtotal, promoDiscount],
  );

  const groupedServiceLines = useMemo(
    () => groupLineItemsByCategory(form.service_line_items),
    [form.service_line_items],
  );

  function handleClientChange(clientId: string) {
    const customer = initialCustomers.find((entry) => entry.client_id === clientId);
    setForm((current) => ({
      ...current,
      client_id: clientId,
      opportunity_id: "",
      bill_to_name: customer?.client_name ?? "",
      bill_to_address: customer?.address ?? "",
      service_line_items: current.service_line_items.filter((line) => !line.site_id),
    }));
    setSitePicker("");
  }

  function updateServiceLine(
    key: string,
    patch: Partial<ServiceQuoteFormLineItem>,
  ) {
    setForm((current) => ({
      ...current,
      service_line_items: current.service_line_items.map((line) =>
        line.key === key ? { ...line, ...patch } : line,
      ),
    }));
  }

  function updateProductLine(
    key: string,
    patch: Partial<ProductQuoteFormLineItem>,
  ) {
    setForm((current) => ({
      ...current,
      product_line_items: current.product_line_items.map((line) => {
        if (line.key !== key) {
          return line;
        }

        const next = { ...line, ...patch };
        if (patch.product_id) {
          const product = initialProducts.find(
            (entry) => entry.id === patch.product_id,
          );
          if (product) {
            next.description = `${product.product_code} — ${product.product_name}`;
            if (!line.unit_price || line.unit_price === 0) {
              next.unit_price = product.standard_selling_price ?? 0;
            }
          }
        }
        return next;
      }),
    }));
  }

  function addServiceLine() {
    setForm((current) => ({
      ...current,
      service_line_items: reindexServiceLines([
        ...current.service_line_items,
        emptyServiceQuoteLine(current.service_line_items.length),
      ]),
    }));
  }

  function addSiteServiceLine(siteCode: string) {
    const site = clientSites.find((entry) => entry.site_code === siteCode);
    if (!site) {
      return;
    }

    setForm((current) => ({
      ...current,
      service_line_items: reindexServiceLines([
        ...current.service_line_items,
        {
          ...emptyServiceQuoteLine(current.service_line_items.length),
          site_id: site.site_code,
          description: site.site_name,
        },
      ]),
    }));
    setSitePicker("");
  }

  function removeServiceLine(key: string) {
    setForm((current) => ({
      ...current,
      service_line_items: reindexServiceLines(
        current.service_line_items.filter((line) => line.key !== key),
      ),
    }));
  }

  function addProductLine() {
    setForm((current) => ({
      ...current,
      product_line_items: reindexProductLines([
        ...current.product_line_items,
        emptyProductQuoteLine(current.product_line_items.length),
      ]),
    }));
  }

  function removeProductLine(key: string) {
    setForm((current) => ({
      ...current,
      product_line_items: reindexProductLines(
        current.product_line_items.filter((line) => line.key !== key),
      ),
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    if (!form.client_id.trim()) {
      setError("Customer is required.");
      setSaving(false);
      return;
    }

    if (!form.bill_to_name.trim()) {
      setError("Bill-to name is required.");
      setSaving(false);
      return;
    }

    const activeLines =
      form.quote_type === "service"
        ? form.service_line_items
        : form.product_line_items;

    if (activeLines.length === 0) {
      setError("Add at least one line item.");
      setSaving(false);
      return;
    }

    if (form.quote_type === "service") {
      for (const [index, line] of form.service_line_items.entries()) {
        if (!line.description.trim()) {
          setError(`Service line ${index + 1} description is required.`);
          setSaving(false);
          return;
        }
      }
    } else {
      for (const [index, line] of form.product_line_items.entries()) {
        if (!line.product_id) {
          setError(`Product line ${index + 1} requires a product.`);
          setSaving(false);
          return;
        }
        if (line.quantity <= 0) {
          setError(`Product line ${index + 1} quantity must be greater than zero.`);
          setSaving(false);
          return;
        }
      }
    }

    const lineItemsPayload =
      form.quote_type === "service"
        ? reindexServiceLines(form.service_line_items).map((line, index) =>
            serviceLineToRpcInput(line, index),
          )
        : reindexProductLines(form.product_line_items).map((line, index) =>
            productLineToRpcInput(line, index),
          );

    if (mode === "create") {
      const { data, error: rpcError } = await supabase.rpc("create_sales_quote", {
        p_client_id: form.client_id.trim(),
        p_opportunity_id: form.opportunity_id.trim() || null,
        p_quote_type: form.quote_type,
        p_expiry_date: form.expiry_date.trim() || null,
        p_bill_to_name: form.bill_to_name.trim(),
        p_bill_to_address: form.bill_to_address.trim() || null,
        p_notes: form.notes.trim() || null,
        p_line_items: lineItemsPayload,
      });

      if (rpcError) {
        setError(rpcError.message);
        setSaving(false);
        return;
      }

      if (!data) {
        setError("Quote was not created.");
        setSaving(false);
        return;
      }

      if (promoDiscount > 0) {
        const { error: promoUpdateError } = await supabase
          .from("sales_quotes")
          .update({
            discount_amount: promoDiscount,
            total_amount: quoteTotal,
          })
          .eq("id", String(data));

        if (promoUpdateError) {
          setError(
            `Quote created, but promo discount could not be saved: ${promoUpdateError.message}`,
          );
          setSaving(false);
          return;
        }
      }

      router.push(`/dashboard/crm/quotes/${String(data)}`);
      router.refresh();
      return;
    }

    if (!quoteId) {
      setError("Missing quote id for edit.");
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("sales_quotes")
      .update({
        client_id: form.client_id.trim(),
        opportunity_id: form.opportunity_id.trim() || null,
        quote_type: form.quote_type,
        expiry_date: form.expiry_date.trim() || null,
        bill_to_name: form.bill_to_name.trim(),
        bill_to_address: form.bill_to_address.trim() || null,
        notes: form.notes.trim() || null,
        subtotal: totals.subtotal,
        discount_amount: promoDiscount,
        total_amount: quoteTotal,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    const { error: deleteLinesError } = await supabase
      .from("sales_quote_line_items")
      .delete()
      .eq("quote_id", quoteId);

    if (deleteLinesError) {
      setError(deleteLinesError.message);
      setSaving(false);
      return;
    }

    const insertRows = lineItemsPayload.map((line) => ({
      quote_id: quoteId,
      product_id: line.product_id ?? null,
      site_id: line.site_id ?? null,
      category_label: line.category_label ?? null,
      description: line.description,
      quantity: line.quantity ?? null,
      unit_price: line.unit_price ?? null,
      labour_amount: line.labour_amount ?? 0,
      material_amount: line.material_amount ?? 0,
      discount_amount: line.discount_amount ?? 0,
      total_cost: line.total_cost,
      sort_order: line.sort_order,
    }));

    const { error: insertLinesError } = await supabase
      .from("sales_quote_line_items")
      .insert(insertRows);

    if (insertLinesError) {
      setError(insertLinesError.message);
      setSaving(false);
      return;
    }

    router.push(`/dashboard/crm/quotes/${quoteId}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className={cardClassName}>
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
              Linked Opportunity
            </label>
            <select
              value={form.opportunity_id}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  opportunity_id: event.target.value,
                }))
              }
              disabled={!form.client_id || clientOpportunities.length === 0}
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
              Quote Type *
            </label>
            <select
              value={form.quote_type}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  quote_type: event.target.value as QuoteType,
                }))
              }
              disabled={mode === "edit"}
              className={inputClassName}
            >
              <option value="service">Service</option>
              <option value="product">Product</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Expiry Date
            </label>
            <input
              type="date"
              value={form.expiry_date}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  expiry_date: event.target.value,
                }))
              }
              className={inputClassName}
            />
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

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Bill To Address
            </label>
            <textarea
              rows={2}
              value={form.bill_to_address}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  bill_to_address: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Notes
            </label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
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
              {form.quote_type === "service"
                ? "Service quotes use site/category, labour, material, and discount lines."
                : "Product quotes use finished products with quantity and unit price."}
            </p>
          </div>

          {form.quote_type === "service" ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={sitePicker}
                disabled={!form.client_id || clientSites.length === 0}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value) {
                    addSiteServiceLine(value);
                  }
                }}
                className={inputClassName}
              >
                <option value="">
                  {form.client_id ? "Add site line…" : "Select customer first"}
                </option>
                {clientSites.map((site) => (
                  <option key={site.site_code} value={site.site_code}>
                    {site.site_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addServiceLine}
                className={secondaryButtonClassName}
              >
                Add Manual Line
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={addProductLine}
              className={secondaryButtonClassName}
            >
              Add Product Line
            </button>
          )}
        </div>

        {form.quote_type === "service" ? (
          form.service_line_items.length === 0 ? (
            <p className="text-sm text-slate-500">No line items yet.</p>
          ) : (
            <div className="space-y-6">
              {groupedServiceLines.map((group) => (
                <div key={group.label} className="space-y-3">
                  <h4 className="text-sm font-semibold text-[#0f2744]">
                    {group.label}
                  </h4>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="px-3 py-2">Description</th>
                          <th className="px-3 py-2">Category</th>
                          <th className="px-3 py-2">Service Cost (GHS)</th>
                          <th className="px-3 py-2">Material Cost (GHS)</th>
                          <th className="px-3 py-2">Discount</th>
                          <th className="px-3 py-2">Total</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {group.items.map((line) => (
                          <tr key={line.key}>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                required
                                value={line.description}
                                onChange={(event) =>
                                  updateServiceLine(line.key, {
                                    description: event.target.value,
                                  })
                                }
                                className={inputClassName}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={line.category_label}
                                onChange={(event) =>
                                  updateServiceLine(line.key, {
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
                                value={line.labour_amount}
                                onChange={(event) =>
                                  updateServiceLine(line.key, {
                                    labour_amount:
                                      Number(event.target.value) || 0,
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
                                value={line.material_amount}
                                onChange={(event) =>
                                  updateServiceLine(line.key, {
                                    material_amount:
                                      Number(event.target.value) || 0,
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
                                value={line.discount_amount}
                                onChange={(event) =>
                                  updateServiceLine(line.key, {
                                    discount_amount:
                                      Number(event.target.value) || 0,
                                  })
                                }
                                className={inputClassName}
                              />
                            </td>
                            <td className="px-3 py-2 font-medium">
                              {formatQuoteMoney(computeServiceLineTotal(line))}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => removeServiceLine(line.key)}
                                className="text-sm text-red-700 hover:underline"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : form.product_line_items.length === 0 ? (
          <p className="text-sm text-slate-500">No line items yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Quantity</th>
                  <th className="px-3 py-2">Unit Price</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {form.product_line_items.map((line) => (
                  <tr key={line.key}>
                    <td className="px-3 py-2">
                      <select
                        required
                        value={line.product_id}
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
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={line.quantity}
                        onChange={(event) =>
                          updateProductLine(line.key, {
                            quantity: Number(event.target.value) || 0,
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
                        value={line.unit_price}
                        onChange={(event) =>
                          updateProductLine(line.key, {
                            unit_price: Number(event.target.value) || 0,
                          })
                        }
                        className={inputClassName}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {formatQuoteMoney(computeProductLineTotal(line))}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removeProductLine(line.key)}
                        className="text-sm text-red-700 hover:underline"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={cardClassName}>
        <PromoCodeField
          supabase={supabase}
          clientId={form.client_id.trim() || null}
          orderAmount={totals.subtotal}
          sourceType="invoice"
          sourceReference={quoteId ?? null}
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

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-600">
              Subtotal:{" "}
              <span className="font-semibold text-[#0f2744]">
                {formatQuoteMoney(totals.subtotal)}
              </span>
            </p>
            {promoDiscount > 0 ? (
              <p className="text-sm text-emerald-800">
                Promo discount ({appliedPromoCode}): -{formatQuoteMoney(promoDiscount)}
              </p>
            ) : null}
            <p className="text-sm text-slate-600">
              Total:{" "}
              <span className="text-lg font-semibold text-[#0f2744]">
                {formatQuoteMoney(quoteTotal)}
              </span>
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className={primaryButtonClassName}
            >
              {saving
                ? "Saving…"
                : mode === "create"
                  ? "Create Quote"
                  : "Save Quote"}
            </button>
            <Link href="/dashboard/crm/quotes" className={secondaryButtonClassName}>
              Cancel
            </Link>
          </div>
        </div>
      </section>
    </form>
  );
}

export { emptyQuoteForm };
