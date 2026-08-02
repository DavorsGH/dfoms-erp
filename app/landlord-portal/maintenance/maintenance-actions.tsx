"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMaintenanceMoney } from "@/app/dashboard/real-estate/maintenance-utils";
import {
  portalDangerButtonClassName,
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
} from "../portal-ui";

type MaintenanceActionsProps = {
  requestId: string;
  tenantSelfFix: boolean;
  proposedCostGhs: number | null;
};

export default function LandlordPortalMaintenanceActions({
  requestId,
  tenantSelfFix,
  proposedCostGhs,
}: MaintenanceActionsProps) {
  const router = useRouter();
  const [confirmedCost, setConfirmedCost] = useState(
    proposedCostGhs != null ? String(proposedCostGhs) : "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(decision: "approve" | "reject") {
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (decision === "approve" && tenantSelfFix) {
      const parsed = Number(confirmedCost);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Enter a valid self-fix cost (GHS) to approve.");
        setLoading(false);
        return;
      }
      if (
        !window.confirm(
          `Approve self-fix cost ${formatMaintenanceMoney(parsed)}? This amount will be credited against the tenant’s next rent.`,
        )
      ) {
        setLoading(false);
        return;
      }
    } else if (decision === "approve") {
      if (!window.confirm("Approve this maintenance request?")) {
        setLoading(false);
        return;
      }
    } else if (
      !window.confirm(
        "Reject this maintenance request? No financial change will be made.",
      )
    ) {
      setLoading(false);
      return;
    }

    const body: Record<string, unknown> = {
      request_id: requestId,
      decision,
    };
    if (decision === "approve" && tenantSelfFix) {
      body.confirmed_cost_ghs = Number(confirmedCost);
    }

    const response = await fetch("/api/landlord-portal/maintenance/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(
        payload?.error ??
          `Unable to ${decision === "approve" ? "approve" : "reject"} request.`,
      );
      setLoading(false);
      return;
    }

    setSuccess(
      decision === "approve"
        ? tenantSelfFix
          ? "Approved. Self-fix cost credited against next rent."
          : "Maintenance request approved."
        : "Maintenance request rejected.",
    );
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
      {tenantSelfFix ? (
        <div>
          <p className="text-sm text-amber-950">
            Tenant self-fix pending
            {proposedCostGhs != null
              ? ` (proposed ${formatMaintenanceMoney(proposedCostGhs)})`
              : ""}
            . Confirm the cost to credit against their next rent.
          </p>
          <label
            htmlFor={`self-fix-cost-${requestId}`}
            className={`${portalLabelClassName} mt-2`}
          >
            Confirmed cost (GHS)
          </label>
          <input
            id={`self-fix-cost-${requestId}`}
            type="number"
            min={0}
            step="0.01"
            className={portalInputClassName}
            value={confirmedCost}
            onChange={(event) => setConfirmedCost(event.target.value)}
            disabled={loading}
          />
        </div>
      ) : (
        <p className="text-sm text-amber-950">
          Landlord approval is pending. Approving notifies the tenant; no escrow
          deduction for platform-only accounts.
        </p>
      )}

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={portalPrimaryButtonClassName}
          disabled={loading}
          onClick={() => void submit("approve")}
        >
          {loading
            ? "Working…"
            : tenantSelfFix
              ? "Approve (credit next rent)"
              : "Approve"}
        </button>
        <button
          type="button"
          className={portalDangerButtonClassName}
          disabled={loading}
          onClick={() => void submit("reject")}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
