"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  extractPaystackInlineReference,
  openPaystackInlineWithAccessCode,
} from "@/app/dashboard/pos/paystack-inline";
import {
  formatUnitBillingActivationStatus,
  type UnitBillingActivationStatus,
} from "@/app/dashboard/real-estate/properties-utils";

type Props = {
  unitId: string;
  unitNumber: string;
  billingActivationStatus: UnitBillingActivationStatus;
  billingActivatedAt: string | null;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
};

async function confirmActivationPayment(unitId: string, reference: string) {
  const response = await fetch(
    "/api/landlord-portal/billing/units/activation-charge/confirm",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit_id: unitId, reference }),
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "Payment confirmation failed.");
  }
}

export async function openUnitActivationPaystackInline(options: {
  unitId: string;
  accessCode: string;
  reference: string;
}): Promise<void> {
  await openPaystackInlineWithAccessCode(options.accessCode, {
    onSuccess: async (transaction) => {
      const reference = extractPaystackInlineReference(
        transaction,
        options.reference,
      );
      if (!reference) {
        throw new Error("Paystack did not return a payment reference.");
      }
      await confirmActivationPayment(options.unitId, reference);
    },
  });
}

export default function UnitBillingActivationControls({
  unitId,
  unitNumber,
  billingActivationStatus,
  billingActivatedAt,
  onError,
  onSuccess,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function activate(triggerType: "activation" | "reactivation") {
    setLoading(true);
    onError?.("");
    try {
      const response = await fetch("/api/landlord-portal/billing/units/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit_id: unitId, trigger_type: triggerType }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        requires_payment?: boolean;
        access_code?: string;
        reference?: string;
        trial?: boolean;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to activate unit billing.");
      }

      if (payload?.requires_payment && payload.access_code && payload.reference) {
        await openUnitActivationPaystackInline({
          unitId,
          accessCode: payload.access_code,
          reference: payload.reference,
        });
        onSuccess?.(
          `Unit ${unitNumber} billing activated after payment.`,
        );
      } else if (payload?.trial) {
        onSuccess?.(
          `Unit ${unitNumber} activated for billing (free during trial).`,
        );
      } else {
        onSuccess?.(`Unit ${unitNumber} activated for billing (GHS 110 charged).`);
      }

      router.refresh();
    } catch (error) {
      onError?.(
        error instanceof Error ? error.message : "Unit billing activation failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function deactivate() {
    setLoading(true);
    onError?.("");
    try {
      const response = await fetch(
        "/api/landlord-portal/billing/units/deactivate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unit_id: unitId }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to deactivate unit billing.");
      }
      onSuccess?.(
        `Unit ${unitNumber} deactivated for billing (no refund; future billing only).`,
      );
      router.refresh();
    } catch (error) {
      onError?.(
        error instanceof Error
          ? error.message
          : "Unit billing deactivation failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-600">
        Billing: {formatUnitBillingActivationStatus(billingActivationStatus)}
      </p>
      <div className="flex flex-wrap gap-2">
        {billingActivationStatus === "inactive" ? (
          <button
            type="button"
            disabled={loading}
            onClick={() =>
              void activate(billingActivatedAt ? "reactivation" : "activation")
            }
            className="rounded-md bg-[#0f2744] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
          >
            {loading ? "Working…" : "Activate (GHS 110)"}
          </button>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={() => void deactivate()}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Working…" : "Deactivate billing"}
          </button>
        )}
      </div>
    </div>
  );
}
