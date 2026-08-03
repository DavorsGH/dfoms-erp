"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";

type OneTimeChargeFormProps = {
  /** Staff admin API vs landlord portal API. */
  mode: "staff" | "landlord";
  tenantId: string;
  leaseId: string;
  leaseActive: boolean;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

/**
 * Create a one-time lease charge (description + amount).
 * Staff: any landlord. Landlord portal: platform_only only (parent gates visibility).
 */
export default function OneTimeChargeForm({
  mode,
  tenantId,
  leaseId,
  leaseActive,
}: OneTimeChargeFormProps) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!leaseActive) {
      setError("One-time charges can only be added to an active lease.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const endpoint =
      mode === "staff"
        ? "/api/admin/rent-ledger/one-time-charge"
        : "/api/landlord-portal/rent-ledger/one-time-charge";

    const body =
      mode === "staff"
        ? {
            tenant_id: tenantId,
            lease_id: leaseId,
            description,
            amount_ghs: amount,
          }
        : {
            lease_id: leaseId,
            description,
            amount_ghs: amount,
          };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      amount_due_ghs?: number;
      description?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to create one-time charge.");
      setLoading(false);
      return;
    }

    setDescription("");
    setAmount("");
    setLoading(false);
    setSuccess(
      `One-time charge created${
        payload?.description ? `: ${payload.description}` : ""
      }.`,
    );
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
      {!leaseActive ? (
        <p className="text-sm text-amber-800">
          Lease is not active — one-time charges cannot be added.
        </p>
      ) : null}
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Description
        </label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          maxLength={500}
          required
          placeholder="e.g. Key replacement, damage repair"
          className={textareaClassName}
          disabled={loading || !leaseActive}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Amount (GHS)
        </label>
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
          className={inputClassName}
          disabled={loading || !leaseActive}
        />
      </div>
      <button
        type="submit"
        disabled={loading || !leaseActive}
        className={primaryButtonClassName}
      >
        {loading ? "Creating…" : "Add one-time charge"}
      </button>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm text-emerald-700" role="status">
          {success}
        </p>
      ) : null}
    </form>
  );
}
