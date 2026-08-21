"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatBillingCycle,
  formatProductPrice,
} from "../crm/products/products-utils";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  extractPaystackInlineReference,
  openPaystackInlineWithAccessCode,
} from "@/app/dashboard/pos/paystack-inline";
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
import {
  formatSubscriptionAccessEndDate,
  SUBSCRIPTION_CANCELLATION_REASONS,
  type SubscriptionCancellationReason,
} from "@/utils/subscription-cancellation";
import { formatTrialCountdownMessage } from "@/utils/subscription-date-display";
import { subscriptionCancelledAccessActive } from "@/utils/subscription-access";
import PaymentSettings from "./payment-settings";

export type BillingTierOption = {
  id: string;
  name: string;
  unit_price: number | null;
  price_ghs: number | null;
  billing_cycle: string | null;
  is_active: boolean | null;
  category: string | null;
  paystack_plan_code: string | null;
};

export type SmsCreditPackOption = {
  pack_key: string;
  credits: number;
  price_ghs: number;
  is_active: boolean;
};

type BillingSettingsProps = {
  subscription: TenantBillingSubscription;
  workspaceName: string;
  billingSettings: BillingSettingsRow;
  invoices: BillingInvoiceRow[];
  tierOptions: BillingTierOption[];
  smsCreditPacks: SmsCreditPackOption[];
  smsCreditBalance: number;
  /** False for Davors platform tenant — Hubtel account holder, not a prepaid SMS customer. */
  showSmsCreditPurchase?: boolean;
  fetchError: string | null;
  /** Initial tab, e.g. from ?tab=payment deep links (POS Payment Settings). */
  initialTab?: "billing" | "payment";
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const cardClassName =
  "space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerSectionClassName =
  "space-y-4 rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm";

const tabClassName = (active: boolean) =>
  `shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-[#0f2744] text-white"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
  }`;

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

function formatSmsPackPrice(priceGhs: number): string {
  return `GH₵ ${Number(priceGhs).toLocaleString("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

type SubscriptionPaymentMethod = {
  last4: string | null;
  brand: string | null;
  exp_month: string | null;
  exp_year: string | null;
  channel: string | null;
  reusable: boolean | null;
};

function formatPaymentMethodBrand(brand: string | null): string {
  if (!brand?.trim()) {
    return "Card";
  }
  return brand.trim().replace(/_/g, " ");
}

function formatPaymentMethodExpiry(
  expMonth: string | null,
  expYear: string | null,
): string | null {
  if (!expMonth || !expYear) {
    return null;
  }
  const month = expMonth.padStart(2, "0");
  const year = expYear.length === 2 ? `20${expYear}` : expYear;
  return `${month}/${year}`;
}

function subscriptionPaymentMethodOnFile(
  paymentMethod: SubscriptionPaymentMethod | null,
): boolean {
  return Boolean(paymentMethod?.last4?.trim() || paymentMethod?.brand?.trim());
}

function formatErpTrialEndDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function BillingSettings({
  subscription,
  workspaceName,
  billingSettings,
  invoices,
  tierOptions,
  smsCreditPacks,
  smsCreditBalance,
  showSmsCreditPurchase = true,
  fetchError,
  initialTab = "billing",
}: BillingSettingsProps) {
  const router = useRouter();
  const [form, setForm] = useState(() => toFormState(billingSettings));
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [checkoutLoadingId, setCheckoutLoadingId] = useState<string | null>(
    null,
  );
  const [smsPackLoadingKey, setSmsPackLoadingKey] = useState<string | null>(
    null,
  );
  const [walletBalance, setWalletBalance] = useState(smsCreditBalance);
  const [activeTab, setActiveTab] = useState<"billing" | "payment">(initialTab);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] =
    useState<SubscriptionCancellationReason>("too_expensive");
  const [cancelReasonDetail, setCancelReasonDetail] = useState("");
  const [cancelNameConfirmation, setCancelNameConfirmation] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] =
    useState<SubscriptionPaymentMethod | null>(null);
  const [paymentMethodLoading, setPaymentMethodLoading] = useState(false);
  const [manageLinkLoading, setManageLinkLoading] = useState(false);

  useEffect(() => {
    setWalletBalance(smsCreditBalance);
  }, [smsCreditBalance]);

  useEffect(() => {
    if (!subscription.paystackSubscriptionId) {
      setPaymentMethod(null);
      setPaymentMethodLoading(false);
      return;
    }

    let cancelled = false;

    async function loadPaymentMethod() {
      setPaymentMethodLoading(true);
      try {
        const response = await fetch("/api/billing/subscription/payment-method");
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          needs_checkout?: boolean;
          payment_method?: SubscriptionPaymentMethod | null;
        } | null;

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setError(
            payload?.error ??
              "Unable to load subscription payment method from Paystack.",
          );
          setPaymentMethod(null);
          return;
        }

        setPaymentMethod(payload?.payment_method ?? null);
      } catch {
        if (!cancelled) {
          setError("Unable to load subscription payment method from Paystack.");
          setPaymentMethod(null);
        }
      } finally {
        if (!cancelled) {
          setPaymentMethodLoading(false);
        }
      }
    }

    void loadPaymentMethod();

    return () => {
      cancelled = true;
    };
  }, [subscription.paystackSubscriptionId]);

  const planState = formatBillingPlanState(
    subscription.subscriptionStatus,
    subscription.tierName,
  );
  const sortedTiers = sortTierOptions(
    tierOptions.filter((tier) => tier.is_active !== false),
  );

  const accessEndLabel = formatSubscriptionAccessEndDate(
    subscription.nextBillingDate,
  );
  const cancelledWithinPaidPeriod = subscriptionCancelledAccessActive({
    subscription_status: subscription.subscriptionStatus ?? "restricted",
    next_billing_date: subscription.nextBillingDate,
  });
  const changePlanDisabled =
    subscription.subscriptionStatus === "cancelled" &&
    !cancelledWithinPaidPeriod;
  const canCancelSubscription =
    !subscription.billingWaived &&
    Boolean(subscription.paystackSubscriptionId) &&
    (subscription.subscriptionStatus === "active" ||
      subscription.subscriptionStatus === "past_due");
  const cancelNameMatches =
    cancelNameConfirmation.trim() === workspaceName.trim();
  const cancelReasonValid =
    cancelReason !== "other" || cancelReasonDetail.trim().length > 0;
  const cancelSubmitEnabled =
    cancelNameMatches && cancelReasonValid && !cancelLoading;
  const hasPaystackSubscription = Boolean(subscription.paystackSubscriptionId);
  const paymentMethodOnFile = subscriptionPaymentMethodOnFile(paymentMethod);
  const cardExpiryLabel = formatPaymentMethodExpiry(
    paymentMethod?.exp_month ?? null,
    paymentMethod?.exp_year ?? null,
  );

  async function handleManageSubscriptionPaymentMethod() {
    setManageLinkLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch(
      "/api/billing/subscription/payment-method/manage-link",
      { method: "POST" },
    );

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      link?: string;
      needs_checkout?: boolean;
    } | null;

    if (!response.ok || !payload?.link) {
      setManageLinkLoading(false);
      setError(
        payload?.error ??
          "Unable to open Paystack card management. Try again or contact support.",
      );
      return;
    }

    window.location.assign(payload.link);
  }

  function resetCancelModal() {
    setCancelModalOpen(false);
    setCancelReason("too_expensive");
    setCancelReasonDetail("");
    setCancelNameConfirmation("");
    setCancelLoading(false);
  }

  async function handleCancelSubscription(event: React.FormEvent) {
    event.preventDefault();
    if (!cancelSubmitEnabled) {
      return;
    }

    setCancelLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/billing/subscription/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: cancelReason,
        reason_detail:
          cancelReason === "other" ? cancelReasonDetail.trim() : null,
        workspace_name_confirmation: cancelNameConfirmation.trim(),
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      access_until?: string | null;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to cancel subscription.");
      setCancelLoading(false);
      return;
    }

    resetCancelModal();
    setSuccess(
      `Subscription cancelled. You keep full access until ${formatSubscriptionAccessEndDate(payload?.access_until ?? subscription.nextBillingDate)}.`,
    );
    router.refresh();
  }

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

  async function handleTierSelect(tier: BillingTierOption) {
    setError(null);
    setSuccess(null);
    setCheckoutLoadingId(tier.id);

    const response = await fetch("/api/billing/checkout/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: tier.id }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      authorization_url?: string;
    } | null;

    if (!response.ok || !payload?.authorization_url) {
      setCheckoutLoadingId(null);
      setError(
        payload?.error ??
          "Unable to start Paystack checkout. Try again or contact support.",
      );
      return;
    }

    window.location.assign(payload.authorization_url);
  }

  async function handleBuySmsPack(pack: SmsCreditPackOption) {
    setError(null);
    setSuccess(null);
    setSmsPackLoadingKey(pack.pack_key);

    try {
      const initResponse = await fetch("/api/billing/sms-credits/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack_key: pack.pack_key }),
      });

      const initPayload = (await initResponse.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        access_code?: string;
        reference?: string;
        purchase_request_id?: string;
        credits?: number;
      } | null;

      if (!initResponse.ok || !initPayload?.ok) {
        setError(
          initPayload?.error ??
            "Unable to start SMS credit checkout. Try again or contact support.",
        );
        setSmsPackLoadingKey(null);
        return;
      }

      const accessCode = initPayload.access_code?.trim() ?? "";
      const purchaseRequestId = initPayload.purchase_request_id?.trim() ?? "";
      if (!accessCode || !purchaseRequestId) {
        setError("Paystack did not return an access code for SMS credits.");
        setSmsPackLoadingKey(null);
        return;
      }

      await openPaystackInlineWithAccessCode(accessCode, {
        onSuccess: async (transaction) => {
          try {
            const confirmResponse = await fetch(
              "/api/billing/sms-credits/confirm",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  purchase_request_id: purchaseRequestId,
                  reference: extractPaystackInlineReference(
                    transaction,
                    initPayload.reference,
                  ),
                }),
              },
            );
            const confirmPayload =
              (await confirmResponse.json().catch(() => null)) as {
                ok?: boolean;
                error?: string;
                credits?: number;
                balance?: number | null;
              } | null;

            if (!confirmResponse.ok || !confirmPayload?.ok) {
              setError(
                confirmPayload?.error ??
                  "Payment succeeded but credit confirmation failed. Refresh shortly — webhook may still apply it.",
              );
              setSmsPackLoadingKey(null);
              return;
            }

            if (typeof confirmPayload.balance === "number") {
              setWalletBalance(confirmPayload.balance);
            }

            const credited =
              confirmPayload.credits ?? initPayload.credits ?? pack.credits;
            setSuccess(
              `Added ${credited.toLocaleString("en-GH")} SMS credits to your wallet.`,
            );
            setSmsPackLoadingKey(null);
            router.refresh();
          } catch (confirmError) {
            setError(
              confirmError instanceof Error
                ? confirmError.message
                : "Payment confirmation failed.",
            );
            setSmsPackLoadingKey(null);
          }
        },
        onCancel: () => {
          setError("SMS credit payment cancelled.");
          setSmsPackLoadingKey(null);
        },
        onError: (paystackError) => {
          setError(
            paystackError.message?.trim() || "Paystack checkout failed.",
          );
          setSmsPackLoadingKey(null);
        },
      });
    } catch (buyError) {
      setError(
        buyError instanceof Error
          ? buyError.message
          : "Unable to start SMS credit checkout.",
      );
      setSmsPackLoadingKey(null);
    }
  }

  return (
    <div className="max-w-4xl space-y-8">
      <nav className="border-b border-slate-200 pb-4" aria-label="Billing settings">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "billing"}
            onClick={() => setActiveTab("billing")}
            className={tabClassName(activeTab === "billing")}
          >
            Billing Settings
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "payment"}
            onClick={() => setActiveTab("payment")}
            className={tabClassName(activeTab === "payment")}
          >
            Payment Settings
          </button>
        </div>
      </nav>

      <div hidden={activeTab !== "billing"} className="space-y-8">
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
            {subscription.trialStartedAt ? (
              <p className="mt-1 text-xs text-slate-500">
                Trial started:{" "}
                {formatErpTrialEndDate(subscription.trialStartedAt)}
              </p>
            ) : null}
            {subscription.activatedAt ? (
              <p className="mt-1 text-xs text-slate-500">
                Subscribed since:{" "}
                {formatErpTrialEndDate(subscription.activatedAt)}
              </p>
            ) : null}
            {subscription.subscriptionStatus === "trialing" &&
            subscription.trialEndDate ? (
              <p className="mt-1 text-xs text-slate-500">
                {formatTrialCountdownMessage(
                  subscription.trialEndDate,
                  formatErpTrialEndDate(subscription.trialEndDate),
                )}
              </p>
            ) : null}
            {subscription.subscriptionStatus === "cancelled" ? (
              <p className="mt-1 text-xs font-medium text-amber-800">
                {cancelledWithinPaidPeriod
                  ? `Cancelled — access continues until ${accessEndLabel}.`
                  : "Cancelled — access has ended."}
              </p>
            ) : null}
            {subscription.subscriptionStatus === "active" &&
            subscription.nextBillingDate ? (
              <p className="mt-1 text-xs text-slate-500">
                Next billing date:{" "}
                {formatSubscriptionAccessEndDate(subscription.nextBillingDate)}
              </p>
            ) : null}
            {subscription.nextBillingDate &&
            subscription.subscriptionStatus === "past_due" ? (
              <p className="mt-1 text-xs text-slate-500">
                Current billing period ends {accessEndLabel}.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setPlanModalOpen(true)}
            className={secondaryButtonClassName}
            disabled={changePlanDisabled}
          >
            Change Plan
          </button>
        </div>
      </section>

      {showSmsCreditPurchase ? (
      <section className={cardClassName}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Buy SMS Credits
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Prepaid credits for customer SMS. When the wallet is empty,
              transactional messages fall back to email.
            </p>
            <p className="mt-2 text-lg font-semibold text-[#0f2744]">
              {walletBalance.toLocaleString("en-GH")} SMS
              <span className="ml-2 text-sm font-normal text-slate-600">
                current balance
              </span>
            </p>
          </div>
        </div>

        {smsCreditPacks.length === 0 ? (
          <p className="text-sm text-slate-500">
            SMS credit packs are not available yet. Contact support if this
            persists.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {smsCreditPacks.map((pack) => {
              const isLoading = smsPackLoadingKey === pack.pack_key;
              return (
                <button
                  key={pack.pack_key}
                  type="button"
                  disabled={smsPackLoadingKey !== null}
                  onClick={() => handleBuySmsPack(pack)}
                  className="rounded-md border border-slate-200 px-4 py-4 text-left transition-colors hover:border-[#0f2744] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <p className="text-base font-semibold text-[#0f2744]">
                    {pack.credits.toLocaleString("en-GH")} SMS
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatSmsPackPrice(pack.price_ghs)}
                  </p>
                  <p className="mt-3 text-xs font-medium text-[#0f2744]">
                    {isLoading ? "Opening Paystack…" : "Buy with Paystack"}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </section>
      ) : null}

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
            Saved card for automatic subscription renewals across your
            workspace.
          </p>
        </div>

        {!hasPaystackSubscription ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Choose a plan first to set up subscription billing.
            </p>
            <button
              type="button"
              onClick={() => setPlanModalOpen(true)}
              className={secondaryButtonClassName}
              disabled={changePlanDisabled}
            >
              Change Plan
            </button>
          </div>
        ) : paymentMethodLoading ? (
          <p className="text-sm text-slate-500">Loading payment method…</p>
        ) : paymentMethodOnFile ? (
          <div className="space-y-3">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-[#0f2744]">
                {formatPaymentMethodBrand(paymentMethod?.brand ?? null)}
                {paymentMethod?.last4 ? ` •••• ${paymentMethod.last4}` : ""}
                {cardExpiryLabel ? (
                  <span className="ml-2 font-normal text-slate-600">
                    Exp {cardExpiryLabel}
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Used for subscription renewals
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleManageSubscriptionPaymentMethod()}
              disabled={manageLinkLoading}
              className={secondaryButtonClassName}
            >
              {manageLinkLoading ? "Opening Paystack…" : "Replace card"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">No payment method on file</p>
            <button
              type="button"
              onClick={() => void handleManageSubscriptionPaymentMethod()}
              disabled={manageLinkLoading}
              className={secondaryButtonClassName}
            >
              {manageLinkLoading ? "Opening Paystack…" : "Add card"}
            </button>
          </div>
        )}
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

      {canCancelSubscription ? (
        <section className={dangerSectionClassName}>
          <div>
            <h3 className="text-sm font-semibold text-red-900">
              Cancel Subscription
            </h3>
            <p className="mt-2 text-sm text-red-800">
              Stop automatic renewal for this workspace. You will keep full access
              until {accessEndLabel}. After that date, dashboard access will be
              revoked — we do not end access immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCancelModalOpen(true)}
            className={dangerButtonClassName}
          >
            Cancel Subscription
          </button>
        </section>
      ) : subscription.subscriptionStatus === "cancelled" ? (
        <section className={dangerSectionClassName}>
          <h3 className="text-sm font-semibold text-red-900">
            Subscription cancelled
          </h3>
          <p className="mt-2 text-sm text-red-800">
            {cancelledWithinPaidPeriod
              ? `Your subscription is cancelled. Access continues until ${accessEndLabel}.`
              : "Your subscription is cancelled and access has ended. Contact support to resubscribe."}
          </p>
        </section>
      ) : null}

      {cancelModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-subscription-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-red-200 bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3
                  id="cancel-subscription-title"
                  className="text-lg font-semibold text-red-900"
                >
                  Cancel Subscription
                </h3>
                <p className="mt-2 text-sm text-slate-700">
                  This stops future billing. Your team keeps access until{" "}
                  <strong>{accessEndLabel}</strong>, then the workspace will be
                  locked out.
                </p>
              </div>
              <button
                type="button"
                onClick={resetCancelModal}
                disabled={cancelLoading}
                className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleCancelSubscription} className="space-y-4">
              <div>
                <label
                  htmlFor="cancel_reason"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Why are you cancelling?
                </label>
                <select
                  id="cancel_reason"
                  value={cancelReason}
                  onChange={(event) =>
                    setCancelReason(
                      event.target.value as SubscriptionCancellationReason,
                    )
                  }
                  className={inputClassName}
                >
                  {SUBSCRIPTION_CANCELLATION_REASONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {cancelReason === "other" ? (
                <div>
                  <label
                    htmlFor="cancel_reason_detail"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Please tell us more
                  </label>
                  <textarea
                    id="cancel_reason_detail"
                    required
                    rows={3}
                    value={cancelReasonDetail}
                    onChange={(event) =>
                      setCancelReasonDetail(event.target.value)
                    }
                    className={inputClassName}
                    placeholder="Brief reason for cancelling"
                  />
                </div>
              ) : null}

              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                <p className="font-medium">What happens next</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Paystack stops charging at the next renewal date.</li>
                  <li>
                    Access continues until{" "}
                    <strong>{accessEndLabel}</strong>.
                  </li>
                  <li>After that, users cannot sign in to this workspace.</li>
                </ul>
              </div>

              <div>
                <label
                  htmlFor="cancel_name_confirmation"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Type <span className="font-semibold">{workspaceName}</span> to
                  confirm
                </label>
                <input
                  id="cancel_name_confirmation"
                  type="text"
                  autoComplete="off"
                  value={cancelNameConfirmation}
                  onChange={(event) =>
                    setCancelNameConfirmation(event.target.value)
                  }
                  className={inputClassName}
                  placeholder={workspaceName}
                />
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={!cancelSubmitEnabled}
                  className="rounded-md border border-red-400 bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cancelLoading ? "Cancelling…" : "Confirm Cancellation"}
                </button>
                <button
                  type="button"
                  onClick={resetCancelModal}
                  disabled={cancelLoading}
                  className={secondaryButtonClassName}
                >
                  Keep Subscription
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

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
                  Choose a tier and billing cycle. You will be redirected to
                  Paystack to complete payment securely.
                  {cancelledWithinPaidPeriod ? (
                    <>
                      {" "}
                      Resubscribing starts a new Paystack subscription and
                      replaces your cancelled plan when payment confirms.
                    </>
                  ) : null}
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
                  const isCurrent =
                    tier.id === subscription.productId &&
                    subscription.subscriptionStatus !== "cancelled";
                  const isLoading = checkoutLoadingId === tier.id;
                  const hasPlan =
                    typeof tier.paystack_plan_code === "string" &&
                    tier.paystack_plan_code.trim().length > 0;
                  const hasPrice =
                    tier.price_ghs != null && Number(tier.price_ghs) > 0;

                  return (
                    <button
                      key={tier.id}
                      type="button"
                      disabled={
                        isCurrent ||
                        !hasPlan ||
                        !hasPrice ||
                        checkoutLoadingId !== null
                      }
                      onClick={() => handleTierSelect(tier)}
                      className="flex w-full items-start justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3 text-left transition-colors hover:border-[#0f2744] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div>
                        <p className="font-medium text-[#0f2744]">{tier.name}</p>
                        <p className="text-xs text-slate-500">
                          {formatBillingCycle(tier.billing_cycle)}
                        </p>
                        {!hasPlan ? (
                          <p className="mt-1 text-xs text-amber-700">
                            Paystack plan not linked yet
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right text-sm text-slate-700">
                        <p className="font-medium">
                          {formatProductPrice(tier.price_ghs)}
                        </p>
                        {isCurrent ? (
                          <p className="mt-1 text-xs font-medium text-emerald-700">
                            Current plan
                          </p>
                        ) : cancelledWithinPaidPeriod &&
                          tier.id === subscription.productId ? (
                          <p className="mt-1 text-xs font-medium text-[#0f2744]">
                            Resubscribe
                          </p>
                        ) : isLoading ? (
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            Redirecting…
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

      <PaymentSettings
        initialStatus={billingSettings.paystack_subaccount_status}
        hidden={activeTab !== "payment"}
      />
    </div>
  );
}
