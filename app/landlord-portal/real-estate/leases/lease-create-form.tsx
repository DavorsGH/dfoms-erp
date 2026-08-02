"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

export type LandlordPortalVacantUnitOption = {
  unitId: string;
  label: string;
  baseRentGhs: number;
};

export type LandlordPortalLesseeOption = {
  lesseeId: string;
  fullName: string;
};

type LeaseCreateFormProps = {
  vacantUnits: LandlordPortalVacantUnitOption[];
  lessees: LandlordPortalLesseeOption[];
};

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export default function LandlordPortalLeaseCreateForm({
  vacantUnits,
  lessees,
}: LeaseCreateFormProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [unitId, setUnitId] = useState(vacantUnits[0]?.unitId ?? "");
  const [lesseeMode, setLesseeMode] = useState<"existing" | "new">(
    lessees.length > 0 ? "existing" : "new",
  );
  const [lesseeId, setLesseeId] = useState(lessees[0]?.lesseeId ?? "");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [startDate, setStartDate] = useState(todayInputValue());
  const [endDate, setEndDate] = useState("");
  const [rentAmount, setRentAmount] = useState(
    vacantUnits[0] ? String(vacantUnits[0].baseRentGhs) : "",
  );
  const [depositAmount, setDepositAmount] = useState("");
  const [depositDate, setDepositDate] = useState(todayInputValue());
  const [lateFeeEnabled, setLateFeeEnabled] = useState(false);
  const [lateFeeType, setLateFeeType] = useState("fixed");
  const [lateFeeAmount, setLateFeeAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedUnit = useMemo(
    () => vacantUnits.find((unit) => unit.unitId === unitId) ?? null,
    [unitId, vacantUnits],
  );

  function handleUnitChange(nextUnitId: string) {
    setUnitId(nextUnitId);
    const unit = vacantUnits.find((item) => item.unitId === nextUnitId);
    if (unit) {
      setRentAmount(String(unit.baseRentGhs));
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/landlord-portal/leases/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unit_id: unitId,
        lessee_id: lesseeMode === "existing" ? lesseeId : undefined,
        new_lessee:
          lesseeMode === "new"
            ? {
                full_name: newName,
                phone: newPhone,
                email: newEmail || null,
              }
            : null,
        start_date: startDate,
        end_date: endDate,
        rent_amount_ghs: rentAmount,
        deposit_amount_ghs: depositAmount,
        deposit_date_collected: depositDate,
        late_fee_enabled: lateFeeEnabled,
        late_fee_type: lateFeeEnabled ? lateFeeType : null,
        late_fee_amount: lateFeeEnabled ? lateFeeAmount : null,
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

    setSuccess("Lease created.");
    setLoading(false);
    setShowForm(false);
    router.refresh();
    if (payload?.lease_id) {
      router.push(`/landlord-portal/real-estate/leases/${payload.lease_id}`);
    }
  }

  if (vacantUnits.length === 0) {
    return (
      <section className={portalSectionClassName}>
        <p className="text-sm text-slate-600">
          No vacant units available for a new lease. Add a unit or free one
          first.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setSuccess(null);
            setShowForm((current) => !current);
          }}
          className={portalPrimaryButtonClassName}
        >
          {showForm ? "Cancel" : "Add Lease"}
        </button>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      {showForm ? (
        <form
          onSubmit={handleCreate}
          className={`${portalSectionClassName} space-y-4`}
        >
          <h2 className={portalSectionTitleClassName}>New Lease</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={portalLabelClassName}>Vacant unit</label>
              <select
                required
                value={unitId}
                onChange={(event) => handleUnitChange(event.target.value)}
                className={portalInputClassName}
              >
                {vacantUnits.map((unit) => (
                  <option key={unit.unitId} value={unit.unitId}>
                    {unit.label}
                  </option>
                ))}
              </select>
              {selectedUnit ? (
                <p className="mt-1 text-xs text-slate-500">
                  Suggested base rent: {selectedUnit.baseRentGhs}
                </p>
              ) : null}
            </div>

            <div className="sm:col-span-2">
              <label className={portalLabelClassName}>Tenant</label>
              <div className="mb-2 flex gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={lesseeMode === "existing"}
                    disabled={lessees.length === 0}
                    onChange={() => setLesseeMode("existing")}
                  />
                  Existing
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={lesseeMode === "new"}
                    onChange={() => setLesseeMode("new")}
                  />
                  New
                </label>
              </div>
              {lesseeMode === "existing" ? (
                <select
                  required
                  value={lesseeId}
                  onChange={(event) => setLesseeId(event.target.value)}
                  className={portalInputClassName}
                >
                  {lessees.map((lessee) => (
                    <option key={lessee.lesseeId} value={lessee.lesseeId}>
                      {lessee.fullName}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <input
                    required
                    type="text"
                    placeholder="Full name"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    className={portalInputClassName}
                  />
                  <input
                    required
                    type="text"
                    placeholder="Phone"
                    value={newPhone}
                    onChange={(event) => setNewPhone(event.target.value)}
                    className={portalInputClassName}
                  />
                  <input
                    type="email"
                    placeholder="Email (optional)"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    className={portalInputClassName}
                  />
                </div>
              )}
            </div>

            <div>
              <label className={portalLabelClassName}>Start date</label>
              <input
                required
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className={portalInputClassName}
              />
            </div>
            <div>
              <label className={portalLabelClassName}>End date</label>
              <input
                required
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className={portalInputClassName}
              />
            </div>
            <div>
              <label className={portalLabelClassName}>Rent (GHS)</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={rentAmount}
                onChange={(event) => setRentAmount(event.target.value)}
                className={portalInputClassName}
              />
            </div>
            <div>
              <label className={portalLabelClassName}>Deposit (GHS)</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={depositAmount}
                onChange={(event) => setDepositAmount(event.target.value)}
                className={portalInputClassName}
              />
            </div>
            <div>
              <label className={portalLabelClassName}>Deposit collected</label>
              <input
                required
                type="date"
                value={depositDate}
                onChange={(event) => setDepositDate(event.target.value)}
                className={portalInputClassName}
              />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <input
                id="create-late-fee"
                type="checkbox"
                checked={lateFeeEnabled}
                onChange={(event) => setLateFeeEnabled(event.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="create-late-fee" className="text-sm text-slate-700">
                Enable late fees
              </label>
            </div>
            {lateFeeEnabled ? (
              <>
                <div>
                  <label className={portalLabelClassName}>Late fee type</label>
                  <select
                    value={lateFeeType}
                    onChange={(event) => setLateFeeType(event.target.value)}
                    className={portalInputClassName}
                  >
                    <option value="fixed">Fixed</option>
                    <option value="percent">Percent</option>
                  </select>
                </div>
                <div>
                  <label className={portalLabelClassName}>Late fee amount</label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={lateFeeAmount}
                    onChange={(event) => setLateFeeAmount(event.target.value)}
                    className={portalInputClassName}
                  />
                </div>
              </>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className={portalPrimaryButtonClassName}
            >
              {loading ? "Creating…" : "Create lease"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className={portalSecondaryButtonClassName}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
