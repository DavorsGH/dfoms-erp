"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { openPaystackInlineWithAccessCode } from "@/app/dashboard/pos/paystack-inline";
import { formatLandlordTier } from "@/app/dashboard/real-estate/landlords-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

export type LandlordBillingSmsPack = {
  packKey: string;
  credits: number;
  priceGhs: number;
};

type LandlordPortalBillingSettingsProps = {
  subscriptionTier: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  smsCreditBalance: number;
  smsCreditPacks: LandlordBillingSmsPack[];
  billingEmail: string | null;
  fetchError: string | null;
};

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

export default function LandlordPortalBillingSettings({
  subscriptionTier,
  subscriptionStatus,
  trialEndsAt,
  smsCreditBalance,
  smsCreditPacks,
  billingEmail,
  fetchError,
}: LandlordPortalBillingSettingsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [smsPackLoadingKey, setSmsPackLoadingKey] = useState<string | null>(
    null,
  );
  const [walletBalance, setWalletBalance] = useState(smsCreditBalance);

  useEffect(() => {
    setWalletBalance(smsCreditBalance);
  }, [smsCreditBalance]);

  const planLabel = subscriptionTier
    ? formatLandlordTier(subscriptionTier)
    : "No plan assigned";
  const planState = formatPlanStatus(subscriptionStatus, subscriptionTier);

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
                  reference: transaction.reference ?? initPayload.reference,
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
    <div className="space-y-6">
      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Subscription plan</h2>
        <p className="mt-1 text-sm text-slate-600">
          Landlord platform plans are assigned by Davors staff. Self-service
          plan changes are not available here.
        </p>
        <p className="mt-3 text-lg font-semibold text-[#0f2744]">{planLabel}</p>
        <p className="mt-1 text-sm text-slate-600">
          Status: <span className="font-medium text-slate-800">{planState}</span>
        </p>
        {trialEndsAt ? (
          <p className="mt-1 text-xs text-slate-500">
            Trial ends{" "}
            {new Date(trialEndsAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        ) : null}
      </section>

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
  );
}
