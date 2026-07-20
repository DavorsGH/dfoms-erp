"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatBillingCycle,
  formatProductPrice,
  formatUsdPrice,
} from "../crm/products/products-utils";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatCreditBalance,
  formatInvoiceAmount,
  formatInvoiceDate,
  formatInvoiceStatus,
  formatBillingPlanState,
  type BillingInvoiceRow,
  type BillingSettingsRow,
} from "@/utils/billing-settings-types";
import type { TenantBillingSubscription } from "@/utils/billing-subscription";

export type BillingTierOption = {
  id: string;
  name: string;
  unit_price: number | null;
  price_ghs: number | null;
  billing_cycle: string | null;
  is_active: boolean | null;
  category: string | null;
};

type BillingSettingsProps = {
  subscription: TenantBillingSubscription;
  billingSettings: BillingSettingsRow;
  invoices: BillingInvoiceRow[];
  tierOptions: BillingTierOption[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const cardClassName =
  "space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const TIER_RANK: Record<string, number> = {
  Starter: 0,
  Professional: 1,
  Business: 2,
  Enterprise: 3,
};

const BILLING_RANK: Record<string, number> = {
  monthly: 0,
  yearly: 1,
};

function tierSortKey(row: { name: string; billing_cycle: string | null }) {
  const tierName = Object.keys(TIER_RANK).find((tier) => row.name.includes(tier));
  const tierRank = tierName ? TIER_RANK[tierName] : 99;
  const billingRank = row.billing_cycle
    ? (BILLING_RANK[row.billing_cycle] ?? 99)
    : 99;
  return tierRank * 10 + billingRank;
}

function sortTierOptions(rows: BillingTierOption[]): BillingTierOption[] {
  return [...rows].sort(
    (a, b) => tierSortKey(a) - tierSortKey(b) || a.name.localeCompare(b.name),
  );
}

function toFormState(row: BillingSettingsRow) {
  return {
    email_recipient: row.email_recipient ?? "",
    additional_emails: row.additional_emails ?? "",
    bill_to_name: row.bill_to_name ?? "",
    country_region: row.country_region ?? "",
    address_line1: row.address_line1 ?? "",
    business_tax_id: row.business_tax_id ?? "",
  };
}

export default function BillingSettings({
  subscription,
  billingSettings,
  invoices,
  tierOptions,
  fetchError,
}: BillingSettingsProps) {
  const router = useRouter();
  const [form, setForm] = useState(() => toFormState(billingSettings));
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planNotice, setPlanNotice] = useState<string | null>(null);

  const planState = formatBillingPlanState(
    subscription.subscriptionStatus,
    subscription.tierName,
  );
  const sortedTiers = sortTierOptions(
    tierOptions.filter((tier) => tier.is_active !== false),
  );

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/billing-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save billing settings.");
      setSaving(false);
      return;
    }

    setSuccess("Billing details saved.");
    setSaving(false);
    router.refresh();
  }

  function handleTierSelect(tier: BillingTierOption) {
    setPlanModalOpen(false);
    setPlanNotice(
      `Plan change noted for ${tier.name} — our team will follow up.`,
    );
    setSuccess(null);
    setError(null);
  }

  return (
    <div className="max-w-4xl space-y-8">
      <p className="text-sm text-slate-600">
        Manage your subscription, invoices, and billing contact details for this
        workspace.
      </p>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {success}
        </p>
      ) : null}

      {planNotice ? (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {planNotice}
        </p>
      ) : null}

      <section className={cardClassName}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Subscription Plan
            </h3>
            <p className="mt-2 text-lg font-semibold text-[#0f2744]">
              {subscription.tierName ?? "No plan assigned"}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Status: <span className="font-medium text-slate-800">{planState}</span>
            </p>
            {subscription.trialEndDate ? (
              <p className="mt-1 text-xs text-slate-500">
                Trial ends{" "}
                {new Date(subscription.trialEndDate).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setPlanModalOpen(true)}
            className={secondaryButtonClassName}
          >
            Change Plan
          </button>
        </div>
      </section>

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Past Invoices</h3>
          <p className="mt-1 text-xs text-slate-500">
            Invoices issued by Davors for your subscription.
          </p>
        </div>

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Amount</th>
                <th className={scrollableTableThClassName}>Invoice Number</th>
                <th className={scrollableTableThClassName}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {invoices.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No invoices yet
                  </td>
                </tr>
              ) : (
                invoices.map((invoice, index) => (
                  <tr
                    key={invoice.id}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3">
                      {formatInvoiceDate(invoice.invoice_date)}
                    </td>
                    <td className="px-4 py-3">
                      {formatInvoiceAmount(invoice.amount)}
                    </td>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {invoice.invoice_number ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {formatInvoiceStatus(invoice.status)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Payment Methods</h3>
          <p className="mt-1 text-xs text-slate-500">
            Saved cards and payment methods for automatic billing.
          </p>
        </div>
        <p className="text-sm text-slate-600">No payment methods</p>
        <button
          type="button"
          disabled
          title="Coming soon"
          className={secondaryButtonClassName}
        >
          Add new card
        </button>
      </section>

      <section className={cardClassName}>
        <div>
          <h3 className="text-sm font-medium text-slate-700">Credit Balance</h3>
          <p className="mt-1 text-xs text-slate-500">
            Account credit applied to future invoices.
          </p>
        </div>
        <p className="text-2xl font-semibold text-[#0f2744]">
          {formatCreditBalance(billingSettings.credit_balance)}
        </p>
      </section>

      <form onSubmit={handleSave} className="space-y-8">
        <section className={cardClassName}>
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Email Recipient
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Where billing notifications and invoices are sent.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="email_recipient"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Primary email
              </label>
              <input
                id="email_recipient"
                type="email"
                value={form.email_recipient}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email_recipient: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="additional_emails"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Additional emails
              </label>
              <input
                id="additional_emails"
                type="text"
                value={form.additional_emails}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    additional_emails: event.target.value,
                  }))
                }
                placeholder="Comma-separated addresses"
                className={inputClassName}
              />
            </div>
          </div>
        </section>

        <section className={cardClassName}>
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Billing Address &amp; Tax ID
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Shown on invoices and used for tax reporting.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="bill_to_name"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Bill-to name
              </label>
              <input
                id="bill_to_name"
                type="text"
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
              <label
                htmlFor="country_region"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Country / region
              </label>
              <input
                id="country_region"
                type="text"
                value={form.country_region}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    country_region: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="address_line1"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Address line 1
              </label>
              <input
                id="address_line1"
                type="text"
                value={form.address_line1}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    address_line1: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="business_tax_id"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Business tax ID
              </label>
              <input
                id="business_tax_id"
                type="text"
                value={form.business_tax_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    business_tax_id: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
          </div>
        </section>

        <button type="submit" disabled={saving} className={primaryButtonClassName}>
          {saving ? "Saving…" : "Save billing details"}
        </button>
      </form>

      {planModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-plan-title"
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3
                  id="change-plan-title"
                  className="text-lg font-semibold text-[#0f2744]"
                >
                  Change Plan
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Select a tier to request a plan change. No charge will be made
                  until Paystack billing is enabled.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlanModalOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              {sortedTiers.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No subscription tiers are currently available.
                </p>
              ) : (
                sortedTiers.map((tier) => {
                  const isCurrent = tier.id === subscription.productId;

                  return (
                    <button
                      key={tier.id}
                      type="button"
                      disabled={isCurrent}
                      onClick={() => handleTierSelect(tier)}
                      className="flex w-full items-start justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3 text-left transition-colors hover:border-[#0f2744] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div>
                        <p className="font-medium text-[#0f2744]">{tier.name}</p>
                        <p className="text-xs text-slate-500">
                          {formatBillingCycle(tier.billing_cycle)}
                        </p>
                      </div>
                      <div className="text-right text-sm text-slate-700">
                        <p>{formatUsdPrice(tier.unit_price)}</p>
                        <p>{formatProductPrice(tier.price_ghs)}</p>
                        {isCurrent ? (
                          <p className="mt-1 text-xs font-medium text-emerald-700">
                            Current plan
                          </p>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
