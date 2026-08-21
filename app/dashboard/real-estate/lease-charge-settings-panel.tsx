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
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

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
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-6">
      {readOnly ? (
        <p className="text-sm text-slate-600">
          Charge categories are managed by Davors staff for managed leases.
        </p>
      ) : (
        <p className="text-sm text-slate-600">
          All categories default to off. Enable only the charges you want billed
          to this tenant. Recurring categories are added each billing month by
          the rent ledger generator; one-off categories are entered manually when
          a bill arrives.
        </p>
      )}

      {groupedOptions.map(({ group, options }) => (
        <div key={group} className="space-y-3">
          <h4 className="text-sm font-semibold text-[#0f2744]">
            {groupLabel(group)}
          </h4>
          <div className="space-y-3">
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
                  className="rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <input
                        type="checkbox"
                        checked={row.isBilled}
                        onChange={(event) =>
                          updateSetting(option.value, {
                            isBilled: event.target.checked,
                          })
                        }
                        disabled={readOnly || loading}
                      />
                      {option.label}
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
                      className={inputClassName}
                    >
                      {LEASE_CHARGE_BILLING_MODE_OPTIONS.map((billingOption) => (
                        <option key={billingOption.value} value={billingOption.value}>
                          {billingOption.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {showFlatAmount ? (
                    <div className="mt-3">
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Flat monthly amount (GHS)
                      </label>
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
                        className={inputClassName}
                      />
                    </div>
                  ) : null}
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
