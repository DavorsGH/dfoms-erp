"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";
import {
  LEASE_CHARGE_CATEGORY_OPTIONS,
  isLeaseChargeCategory,
  type LeaseChargeCategory,
} from "@/utils/lease-charge-categories";

type OneTimeChargeFormProps = {
  /** Staff admin API vs landlord portal API. */
  mode: "staff" | "landlord";
  tenantId: string;
  leaseId: string;
  leaseActive: boolean;
  /** Tighter grid layout for lease detail pages. */
  compact?: boolean;
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
  compact = false,
}: OneTimeChargeFormProps) {
  const router = useRouter();
  const [chargeCategory, setChargeCategory] = useState<"" | LeaseChargeCategory>(
    "",
  );
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

    if (!chargeCategory && !description.trim()) {
      setError("Enter a description or select a charge category.");
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
            charge_category: chargeCategory || undefined,
            description,
            amount_ghs: amount,
          }
        : {
            lease_id: leaseId,
            charge_category: chargeCategory || undefined,
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

    setChargeCategory("");
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
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className={compact ? "space-y-2" : "space-y-3"}
    >
      {!leaseActive ? (
        <p className="text-sm text-amber-800">
          Lease is not active — one-time charges cannot be added.
        </p>
      ) : null}
      <div
        className={
          compact
            ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]"
            : "space-y-3"
        }
      >
        <div className={compact ? "" : undefined}>
          <label className="mb-0.5 block text-xs font-medium text-slate-700">
            Charge category (optional)
          </label>
          <select
            value={chargeCategory}
            onChange={(event) => {
              const value = event.target.value;
              setChargeCategory(
                value && isLeaseChargeCategory(value) ? value : "",
              );
            }}
            className={inputClassName}
            disabled={loading || !leaseActive}
          >
            <option value="">General / other (no category)</option>
            <optgroup label="Utilities">
              {LEASE_CHARGE_CATEGORY_OPTIONS.filter(
                (option) => option.group === "utilities",
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Service charge">
              {LEASE_CHARGE_CATEGORY_OPTIONS.filter(
                (option) => option.group === "service",
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className={compact ? "sm:col-span-2 lg:col-span-1" : undefined}>
          <label className="mb-0.5 block text-xs font-medium text-slate-700">
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
        <div className={compact ? "sm:col-span-2" : undefined}>
          <label className="mb-0.5 block text-xs font-medium text-slate-700">
            Description
          </label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={compact ? 1 : 2}
            maxLength={500}
            required={!chargeCategory}
            placeholder={
              chargeCategory
                ? "Optional note (category label used if blank)"
                : "e.g. Key replacement, damage repair"
            }
            className={textareaClassName}
            disabled={loading || !leaseActive}
          />
        </div>
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
