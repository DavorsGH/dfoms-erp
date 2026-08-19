"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  extractPaystackInlineReference,
  openPaystackInlineWithAccessCode,
} from "@/app/dashboard/pos/paystack-inline";
import { formatLandlordTier } from "@/app/dashboard/real-estate/landlords-utils";
import type { PaystackSubaccountStatus } from "@/utils/billing-settings-types";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";
import { formatTrialCountdownMessage } from "@/utils/subscription-date-display";
import LandlordPaymentSettings from "./payment-settings";

export type LandlordBillingSmsPack = {
  packKey: string;
  credits: number;
  priceGhs: number;
};

type BillingTab = "billing" | "sms" | "payment";

type LandlordPortalBillingSettingsProps = {
  subscriptionTier: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  trialStartedAt: string | null;
  activatedAt: string | null;
  billingCycle: "monthly" | "annual" | null;
  pendingBillingCycle: "monthly" | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  activeUnitCount: number;
  monthlyUnitPriceGhs: number;
  annualUnitPriceGhs: number;
  nextChargeDate: string | null;
  nextChargeSummary: string | null;
  smsCreditBalance: number;
  smsCreditPacks: LandlordBillingSmsPack[];
  billingEmail: string | null;
  paystackSubaccountStatus: PaystackSubaccountStatus;
  showPaymentSettings: boolean;
  showBillingCycleControls: boolean;
  fetchError: string | null;
  initialTab?: BillingTab;
};

const tabClassName = (active: boolean) =>
  `shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-[#0f2744] text-white"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
  }`;

function formatSmsPackPrice(priceGhs: number): string {
  return `GH₵ ${Number(priceGhs).toLocaleString("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatPlanStatus(
  subscriptionStatus: string | null,
  subscriptionTier: string | null,
): string {
  if (!subscriptionStatus && !subscriptionTier) {
    return "Free";
  }
  if (subscriptionStatus === "trialing") {
    return "Trial";
  }
  if (subscriptionTier) {
    return formatLandlordTier(subscriptionTier);
  }
  return (subscriptionStatus ?? "—")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatIsoDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString(
    "en-GB",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    },
  );
}

export default function LandlordPortalBillingSettings({
  subscriptionTier,
  subscriptionStatus,
  trialEndsAt,
  trialStartedAt,
  activatedAt,
  billingCycle,
  pendingBillingCycle,
  currentPeriodStart,
  currentPeriodEnd,
  activeUnitCount,
  monthlyUnitPriceGhs,
  annualUnitPriceGhs,
  nextChargeDate,
  nextChargeSummary,
  smsCreditBalance,
  smsCreditPacks,
  billingEmail,
  paystackSubaccountStatus,
  showPaymentSettings,
  showBillingCycleControls,
  fetchError,
  initialTab = "billing",
}: LandlordPortalBillingSettingsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<BillingTab>(
    initialTab === "payment" && showPaymentSettings
      ? "payment"
      : initialTab === "sms"
        ? "sms"
        : "billing",
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [smsPackLoadingKey, setSmsPackLoadingKey] = useState<string | null>(
    null,
  );
  const [walletBalance, setWalletBalance] = useState(smsCreditBalance);
  const [cycleLoading, setCycleLoading] = useState<"monthly" | "annual" | null>(
    null,
  );

  useEffect(() => {
    setWalletBalance(smsCreditBalance);
  }, [smsCreditBalance]);

  const planLabel = subscriptionTier
    ? formatLandlordTier(subscriptionTier)
    : "No plan assigned";
  const planState = formatPlanStatus(subscriptionStatus, subscriptionTier);
  const cycleLabel =
    billingCycle === "annual" ? "Annual (per unit / year)" : "Monthly (per unit / month)";
  const formattedTrialEnd = formatIsoDate(trialEndsAt);
  const formattedTrialStart = formatIsoDate(trialStartedAt);
  const formattedSubscribedSince = formatIsoDate(
    activatedAt ? activatedAt.slice(0, 10) : null,
  );
  const formattedNextCharge = formatIsoDate(nextChargeDate);
  const formattedPeriodEnd = formatIsoDate(currentPeriodEnd);

  async function handleBillingCycleSwitch(targetCycle: "monthly" | "annual") {
    setError(null);
    setSuccess(null);
    setCycleLoading(targetCycle);

    const confirmMessage =
      targetCycle === "annual"
        ? subscriptionStatus === "trialing"
          ? "Switch to annual billing after your trial? No charge until your trial ends."
          : `Switch to annual billing now? You will be charged GHS ${(activeUnitCount * annualUnitPriceGhs).toFixed(2)} immediately (${activeUnitCount} active unit${activeUnitCount === 1 ? "" : "s"} × GHS ${annualUnitPriceGhs.toFixed(2)}).`
        : billingCycle === "annual" && subscriptionStatus !== "trialing"
          ? `Switch to monthly billing after your current annual period ends${formattedPeriodEnd ? ` on ${formattedPeriodEnd}` : ""}? No immediate charge.`
          : "Switch to monthly billing?";

    if (!window.confirm(confirmMessage)) {
      setCycleLoading(null);
      return;
    }

    try {
      const response = await fetch("/api/landlord-portal/billing/cycle/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_cycle: targetCycle }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        message?: string;
      } | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to update billing cycle.");
        setCycleLoading(null);
        return;
      }

      setSuccess(payload.message ?? "Billing cycle updated.");
      setCycleLoading(null);
      router.refresh();
    } catch (switchError) {
      setError(
        switchError instanceof Error
          ? switchError.message
          : "Unable to update billing cycle.",
      );
      setCycleLoading(null);
    }
  }

  async function handleBuySmsPack(pack: LandlordBillingSmsPack) {
    setError(null);
    setSuccess(null);
    setSmsPackLoadingKey(pack.packKey);

    if (!billingEmail) {
      setError(
        "Set a valid workspace email in Workspace Settings before buying SMS credits.",
      );
      setSmsPackLoadingKey(null);
      return;
    }

    try {
      const initResponse = await fetch(
        "/api/landlord-portal/billing/sms-credits/initialize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pack_key: pack.packKey }),
        },
      );

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
              "/api/landlord-portal/billing/sms-credits/confirm",
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
    <div className="max-w-4xl space-y-6">
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
            aria-selected={activeTab === "sms"}
            onClick={() => setActiveTab("sms")}
            className={tabClassName(activeTab === "sms")}
          >
            Buy SMS Credits
          </button>
          {showPaymentSettings ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "payment"}
              onClick={() => setActiveTab("payment")}
              className={tabClassName(activeTab === "payment")}
            >
              Payment Settings
            </button>
          ) : null}
        </div>
      </nav>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <div hidden={activeTab !== "billing"} className="space-y-6">
        <section className={portalSectionClassName}>
          <h2 className={portalSectionTitleClassName}>Subscription plan</h2>
          <p className="mt-1 text-sm text-slate-600">
            Landlord platform plans are assigned by Davors staff. Self-service
            plan changes are not available here.
          </p>
          <p className="mt-3 text-lg font-semibold text-[#0f2744]">{planLabel}</p>
          <p className="mt-1 text-sm text-slate-600">
            Status:{" "}
            <span className="font-medium text-slate-800">{planState}</span>
          </p>
          {showBillingCycleControls && formattedTrialStart ? (
            <p className="mt-1 text-xs text-slate-500">
              Trial started: {formattedTrialStart}
            </p>
          ) : null}
          {showBillingCycleControls && formattedSubscribedSince ? (
            <p className="mt-1 text-xs text-slate-500">
              Subscribed since: {formattedSubscribedSince}
            </p>
          ) : null}
          {showBillingCycleControls &&
          subscriptionStatus === "trialing" &&
          trialEndsAt &&
          formattedTrialEnd ? (
            <p className="mt-1 text-xs text-slate-500">
              {formatTrialCountdownMessage(trialEndsAt, formattedTrialEnd)}
            </p>
          ) : null}
          {showBillingCycleControls ? (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-700">
                Billing cycle:{" "}
                <span className="font-medium text-[#0f2744]">{cycleLabel}</span>
              </p>
              {pendingBillingCycle === "monthly" && formattedPeriodEnd ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Switching to monthly billing on {formattedPeriodEnd}. Your
                  prepaid annual period stays active until then.
                </p>
              ) : null}
              {currentPeriodStart && currentPeriodEnd ? (
                <p className="text-xs text-slate-500">
                  Current paid period: {formatIsoDate(currentPeriodStart)} –{" "}
                  {formattedPeriodEnd}
                </p>
              ) : null}
              {subscriptionStatus === "active" && formattedNextCharge ? (
                <p className="text-sm text-slate-600">
                  Next billing date: {formattedNextCharge}
                </p>
              ) : null}
              {subscriptionStatus === "active" && nextChargeSummary ? (
                <p className="text-xs text-slate-500">{nextChargeSummary}</p>
              ) : null}
              {subscriptionStatus === "trialing" && nextChargeSummary ? (
                <p className="text-sm text-slate-600">
                  Next charge: {nextChargeSummary}
                  {formattedNextCharge ? ` (${formattedNextCharge})` : ""}
                </p>
              ) : null}
              <p className="text-xs text-slate-500">
                {activeUnitCount} active billing unit
                {activeUnitCount === 1 ? "" : "s"} · Monthly GHS{" "}
                {monthlyUnitPriceGhs.toFixed(2)}/unit · Annual GHS{" "}
                {annualUnitPriceGhs.toFixed(2)}/unit
              </p>
              <div className="flex flex-wrap gap-2">
                {billingCycle !== "annual" || pendingBillingCycle === "monthly" ? (
                  <button
                    type="button"
                    disabled={cycleLoading !== null}
                    onClick={() => void handleBillingCycleSwitch("annual")}
                    className="rounded-md border border-[#0f2744] px-3 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cycleLoading === "annual"
                      ? "Processing…"
                      : "Switch to annual"}
                  </button>
                ) : null}
                {billingCycle === "annual" && pendingBillingCycle !== "monthly" ? (
                  <button
                    type="button"
                    disabled={cycleLoading !== null}
                    onClick={() => void handleBillingCycleSwitch("monthly")}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cycleLoading === "monthly"
                      ? "Scheduling…"
                      : "Switch to monthly"}
                  </button>
                ) : null}
              </div>
              {subscriptionStatus === "trialing" ? (
                <p className="text-xs text-slate-500">
                  During your trial, switching billing cycle does not charge your
                  card. Your first full charge uses the cycle selected before the
                  trial ends.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <div hidden={activeTab !== "sms"} className="space-y-6">
        <section className={portalSectionClassName}>
          <h2 className={portalSectionTitleClassName}>Buy SMS credits</h2>
          <p className="mt-1 text-xs text-slate-500">
            Prepaid credits for tenant SMS from your landlord workspace wallet.
            When the wallet is empty, transactional messages fall back to email.
          </p>
          <p className="mt-2 text-lg font-semibold text-[#0f2744]">
            {walletBalance.toLocaleString("en-GH")} SMS
            <span className="ml-2 text-sm font-normal text-slate-600">
              current balance
            </span>
          </p>
          {billingEmail ? (
            <p className="mt-1 text-xs text-slate-500">
              Paystack receipt email: {billingEmail}
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-800">
              Add a workspace email under Workspace Settings before purchasing.
            </p>
          )}

          {smsCreditPacks.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              SMS credit packs are not available yet. Contact support if this
              persists.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {smsCreditPacks.map((pack) => {
                const isLoading = smsPackLoadingKey === pack.packKey;
                return (
                  <button
                    key={pack.packKey}
                    type="button"
                    disabled={smsPackLoadingKey !== null}
                    onClick={() => handleBuySmsPack(pack)}
                    className="rounded-md border border-slate-200 px-4 py-4 text-left transition-colors hover:border-[#0f2744] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <p className="text-base font-semibold text-[#0f2744]">
                      {pack.credits.toLocaleString("en-GH")} SMS
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatSmsPackPrice(pack.priceGhs)}
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
      </div>

      {showPaymentSettings ? (
        <LandlordPaymentSettings
          initialStatus={paystackSubaccountStatus}
          hidden={activeTab !== "payment"}
        />
      ) : null}
    </div>
  );
}
