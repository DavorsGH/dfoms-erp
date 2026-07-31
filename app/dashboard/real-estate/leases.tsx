"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import type { LandlordListRow } from "./landlords-utils";
import {
  LATE_FEE_TYPE_OPTIONS,
  formatLeaseDate,
  formatLeaseMoney,
  formatLeaseStatus,
  type LateFeeType,
  type LeaseListRow,
  type LesseeOption,
  type VacantUnitOption,
} from "./leases-utils";

type LeasesProps = {
  landlords: LandlordListRow[];
  selectedLandlordId: string | null;
  initialRows: LeaseListRow[];
  vacantUnits: VacantUnitOption[];
  lesseeOptions: LesseeOption[];
  landlordsError: string | null;
  leasesError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const emptyForm = {
  unit_id: "",
  lessee_mode: "existing" as "existing" | "new",
  lessee_id: "",
  new_full_name: "",
  new_phone: "",
  new_email: "",
  start_date: "",
  end_date: "",
  rent_amount_ghs: "",
  escalation_percent: "",
  escalation_frequency_months: "",
  late_fee_enabled: false,
  late_fee_type: "fixed" as LateFeeType,
  late_fee_amount: "",
  deposit_amount_ghs: "",
  deposit_date_collected: "",
};

export default function Leases({
  landlords,
  selectedLandlordId,
  initialRows,
  vacantUnits,
  lesseeOptions,
  landlordsError,
  leasesError,
}: LeasesProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(
    landlordsError ?? leasesError,
  );
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    setError(landlordsError ?? leasesError);
  }, [landlordsError, leasesError]);

  const selectedLandlord = landlords.find(
    (row) => row.tenantId === selectedLandlordId,
  );

  function handleLandlordChange(tenantId: string) {
    setShowForm(false);
    setForm(emptyForm);
    if (!tenantId) {
      router.push("/dashboard/real-estate/leases");
      return;
    }
    router.push(
      `/dashboard/real-estate/leases?landlord=${encodeURIComponent(tenantId)}`,
    );
  }

  function handleUnitChange(unitId: string) {
    const unit = vacantUnits.find((item) => item.unitId === unitId);
    setForm((current) => ({
      ...current,
      unit_id: unitId,
      rent_amount_ghs:
        current.rent_amount_ghs ||
        (unit ? String(unit.baseRentGhs) : current.rent_amount_ghs),
    }));
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId) {
      return;
    }

    setLoading(true);
    setError(null);

    const response = await fetch("/api/admin/leases/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        unit_id: form.unit_id,
        lessee_id:
          form.lessee_mode === "existing" ? form.lessee_id || null : null,
        new_lessee:
          form.lessee_mode === "new"
            ? {
                full_name: form.new_full_name,
                phone: form.new_phone,
                email: form.new_email || null,
              }
            : null,
        start_date: form.start_date,
        end_date: form.end_date,
        rent_amount_ghs: form.rent_amount_ghs,
        escalation_percent: form.escalation_percent || null,
        escalation_frequency_months: form.escalation_frequency_months || null,
        late_fee_enabled: form.late_fee_enabled,
        late_fee_type: form.late_fee_enabled ? form.late_fee_type : null,
        late_fee_amount: form.late_fee_enabled ? form.late_fee_amount : null,
        deposit_amount_ghs: form.deposit_amount_ghs,
        deposit_date_collected: form.deposit_date_collected,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      lease_id?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to create lease.");
      setLoading(false);
      return;
    }

    setShowForm(false);
    setForm(emptyForm);
    setLoading(false);

    if (payload?.lease_id && selectedLandlordId) {
      router.push(
        `/dashboard/real-estate/leases/${selectedLandlordId}/${payload.lease_id}`,
      );
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <label
          htmlFor="leases-landlord-picker"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Landlord
        </label>
        <select
          id="leases-landlord-picker"
          value={selectedLandlordId ?? ""}
          onChange={(event) => handleLandlordChange(event.target.value)}
          className={inputClassName}
        >
          <option value="">Select a landlord</option>
          {landlords.map((landlord) => (
            <option key={landlord.tenantId} value={landlord.tenantId}>
              {landlord.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!selectedLandlordId ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">
            Select a landlord to view and manage their leases.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Managing leases for{" "}
              <span className="font-medium text-[#0f2744]">
                {selectedLandlord?.name ?? "selected landlord"}
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                setForm(emptyForm);
                setShowForm((current) => !current);
              }}
              className={primaryButtonClassName}
            >
              {showForm ? "Cancel" : "Add Lease"}
            </button>
          </div>

          {showForm ? (
            <form
              onSubmit={handleCreate}
              className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
                New Lease
              </h3>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="md:col-span-2 xl:col-span-3">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Vacant Unit
                  </label>
                  <select
                    required
                    value={form.unit_id}
                    onChange={(event) => handleUnitChange(event.target.value)}
                    className={inputClassName}
                  >
                    <option value="">Select vacant unit</option>
                    {vacantUnits.map((unit) => (
                      <option key={unit.unitId} value={unit.unitId}>
                        {unit.propertyName} — {unit.unitNumber}
                      </option>
                    ))}
                  </select>
                  {vacantUnits.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-500">
                      No vacant units available for this landlord.
                    </p>
                  ) : null}
                </div>

                <div className="md:col-span-2 xl:col-span-3">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Tenant
                  </label>
                  <div className="mb-2 flex flex-wrap gap-4 text-sm text-slate-700">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        checked={form.lessee_mode === "existing"}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            lessee_mode: "existing",
                          }))
                        }
                      />
                      Existing tenant
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        checked={form.lessee_mode === "new"}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            lessee_mode: "new",
                          }))
                        }
                      />
                      Add new tenant
                    </label>
                  </div>
                  {form.lessee_mode === "existing" ? (
                    <select
                      required
                      value={form.lessee_id}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          lessee_id: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    >
                      <option value="">Select tenant</option>
                      {lesseeOptions.map((lessee) => (
                        <option key={lessee.lesseeId} value={lessee.lesseeId}>
                          {lessee.fullName} ({lessee.phone})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-3">
                      <input
                        required
                        type="text"
                        placeholder="Full name"
                        value={form.new_full_name}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            new_full_name: event.target.value,
                          }))
                        }
                        className={inputClassName}
                      />
                      <input
                        required
                        type="text"
                        placeholder="Phone"
                        value={form.new_phone}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            new_phone: event.target.value,
                          }))
                        }
                        className={inputClassName}
                      />
                      <input
                        type="email"
                        placeholder="Email (optional)"
                        value={form.new_email}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            new_email: event.target.value,
                          }))
                        }
                        className={inputClassName}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Start Date
                  </label>
                  <input
                    required
                    type="date"
                    value={form.start_date}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        start_date: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    End Date
                  </label>
                  <input
                    required
                    type="date"
                    value={form.end_date}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        end_date: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Rent (GHS)
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.rent_amount_ghs}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        rent_amount_ghs: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Escalation % (optional)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.escalation_percent}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        escalation_percent: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Escalation Frequency (months)
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={form.escalation_frequency_months}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        escalation_frequency_months: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-md border border-slate-100 bg-slate-50 p-3">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.late_fee_enabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        late_fee_enabled: event.target.checked,
                      }))
                    }
                  />
                  Late fee enabled
                </label>
                {form.late_fee_enabled ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Late Fee Type
                      </label>
                      <select
                        required
                        value={form.late_fee_type}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            late_fee_type: event.target.value as LateFeeType,
                          }))
                        }
                        className={inputClassName}
                      >
                        {LATE_FEE_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Late Fee Amount
                      </label>
                      <input
                        required
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.late_fee_amount}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            late_fee_amount: event.target.value,
                          }))
                        }
                        className={inputClassName}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-3 rounded-md border border-slate-100 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-[#0f2744]">
                  Security Deposit
                </h4>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Amount (GHS)
                    </label>
                    <input
                      required
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.deposit_amount_ghs}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          deposit_amount_ghs: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Date Collected
                    </label>
                    <input
                      required
                      type="date"
                      value={form.deposit_date_collected}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          deposit_date_collected: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className={primaryButtonClassName}
                >
                  {loading ? "Saving…" : "Create Lease"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setForm(emptyForm);
                  }}
                  className={secondaryButtonClassName}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Unit</th>
                  <th className={scrollableTableThClassName}>Tenant</th>
                  <th className={scrollableTableThClassName}>Start Date</th>
                  <th className={scrollableTableThClassName}>End Date</th>
                  <th className={scrollableTableThClassName}>Rent (GHS)</th>
                  <th className={scrollableTableThClassName}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      No leases yet for this landlord.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr
                      key={row.leaseId}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                        <Link
                          href={`/dashboard/real-estate/leases/${row.tenantId}/${row.leaseId}`}
                          className="hover:underline"
                        >
                          {row.propertyName} — {row.unitNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.lesseeName}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatLeaseDate(row.startDate)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatLeaseDate(row.endDate)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatLeaseMoney(row.rentAmountGhs)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatLeaseStatus(row.status)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>
        </>
      )}
    </div>
  );
}
