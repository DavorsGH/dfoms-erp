"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";
import {
  LEASE_CHARGE_BILLING_MODE_OPTIONS,
  LEASE_CHARGE_CATEGORY_OPTIONS,
  type LeaseChargeBillingMode,
  type LeaseChargeSettingRow,
} from "@/utils/lease-charge-categories";

type LeaseChargeSettingsPanelProps = {
  mode: "staff" | "landlord";
  tenantId: string;
  leaseId: string;
  initialSettings: LeaseChargeSettingRow[];
  readOnly?: boolean;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const compactInputClassName = `${inputClassName} min-w-0 w-full py-1.5 text-sm`;

/** Category (fixed) | Mode (flex middle) | Flat GHS (~¼ row). Full-width, no dead gap. */
const CHARGE_ROW_GRID_CLASS =
  "sm:grid-cols-[9.5rem_minmax(14.5rem,3fr)_minmax(7.5rem,1fr)]";

const CHARGE_ROW_GAP_CLASS = "gap-x-0 gap-y-1";

function groupLabel(group: "utilities" | "service"): string {
  return group === "utilities" ? "Utilities" : "Service charge";
}

export default function LeaseChargeSettingsPanel({
  mode,
  tenantId,
  leaseId,
  initialSettings,
  readOnly = false,
}: LeaseChargeSettingsPanelProps) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const groupedOptions = useMemo(() => {
    const utilities = LEASE_CHARGE_CATEGORY_OPTIONS.filter(
      (option) => option.group === "utilities",
    );
    const service = LEASE_CHARGE_CATEGORY_OPTIONS.filter(
      (option) => option.group === "service",
    );
    return [
      { group: "utilities" as const, options: utilities },
      { group: "service" as const, options: service },
    ];
  }, []);

  function updateSetting(
    chargeCategory: LeaseChargeSettingRow["chargeCategory"],
    patch: Partial<LeaseChargeSettingRow>,
  ) {
    setSettings((current) =>
      current.map((row) =>
        row.chargeCategory === chargeCategory ? { ...row, ...patch } : row,
      ),
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const endpoint =
      mode === "staff"
        ? "/api/admin/leases/charge-settings"
        : "/api/landlord-portal/leases/charge-settings";

    const body =
      mode === "staff"
        ? {
            tenant_id: tenantId,
            lease_id: leaseId,
            settings: settings.map((row) => ({
              charge_category: row.chargeCategory,
              is_billed: row.isBilled,
              billing_mode: row.billingMode,
              flat_amount_ghs: row.flatAmountGhs,
            })),
          }
        : {
            lease_id: leaseId,
            settings: settings.map((row) => ({
              charge_category: row.chargeCategory,
              is_billed: row.isBilled,
              billing_mode: row.billingMode,
              flat_amount_ghs: row.flatAmountGhs,
            })),
          };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save charge settings.");
      setLoading(false);
      return;
    }

    setSuccess("Charge settings saved.");
    setLoading(false);
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      {readOnly ? (
        <p className="text-xs text-slate-600">
          Charge categories are managed by Davors staff for managed leases.
        </p>
      ) : (
        <p className="text-xs text-slate-600">
          Enable only the charges billed to this tenant. Recurring rows are
          generated monthly; one-off rows are entered when a bill arrives.
        </p>
      )}

      {groupedOptions.map(({ group, options }) => (
        <div key={group} className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {groupLabel(group)}
          </h4>
          <div
            className={`hidden px-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:grid ${CHARGE_ROW_GAP_CLASS} ${CHARGE_ROW_GRID_CLASS}`}
          >
            <span className="pr-1.5">Category</span>
            <span>Mode</span>
            <span className="pl-1.5">Flat GHS / month</span>
          </div>
          <div className="space-y-1">
            {options.map((option) => {
              const row = settings.find(
                (setting) => setting.chargeCategory === option.value,
              );
              if (!row) {
                return null;
              }
              const showFlatAmount =
                row.isBilled && row.billingMode === "recurring";
              return (
                <div
                  key={option.value}
                  className={`grid items-stretch rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5 sm:grid ${CHARGE_ROW_GAP_CLASS} ${CHARGE_ROW_GRID_CLASS}`}
                >
                  <label className="flex min-w-0 items-center gap-2 pr-1.5 text-sm text-slate-900">
                    <input
                      type="checkbox"
                      checked={row.isBilled}
                      onChange={(event) =>
                        updateSetting(option.value, {
                          isBilled: event.target.checked,
                        })
                      }
                      disabled={readOnly || loading}
                      className="shrink-0"
                    />
                    <span className="truncate">{option.label}</span>
                  </label>
                  <select
                    value={row.billingMode}
                    onChange={(event) =>
                      updateSetting(option.value, {
                        billingMode: event.target
                          .value as LeaseChargeBillingMode,
                      })
                    }
                    disabled={readOnly || loading || !row.isBilled}
                    className={compactInputClassName}
                  >
                    {LEASE_CHARGE_BILLING_MODE_OPTIONS.map((billingOption) => (
                      <option
                        key={billingOption.value}
                        value={billingOption.value}
                      >
                        {billingOption.label}
                      </option>
                    ))}
                  </select>
                  {showFlatAmount ? (
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={row.flatAmountGhs ?? ""}
                      onChange={(event) =>
                        updateSetting(option.value, {
                          flatAmountGhs:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                      required
                      disabled={readOnly || loading}
                      className={compactInputClassName}
                      placeholder="Amount"
                    />
                  ) : (
                    <span className="hidden min-w-0 w-full items-center justify-center text-xs text-slate-400 sm:flex">
                      —
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {!readOnly ? (
        <button
          type="submit"
          disabled={loading}
          className={primaryButtonClassName}
        >
          {loading ? "Saving…" : "Save charge settings"}
        </button>
      ) : null}

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
