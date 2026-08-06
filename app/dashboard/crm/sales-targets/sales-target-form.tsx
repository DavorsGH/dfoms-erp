"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import SalesRepSelect from "@/components/sales-rep-select";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";
import {
  resolveSelectableEmployeeId,
  type HrEmployee,
} from "@/app/dashboard/hr-payroll/employee-utils";
import {
  SALES_TARGET_PERIOD_TYPES,
  buildSalesTargetPayload,
  emptySalesTargetForm,
  validateSalesTargetForm,
  type SalesTargetFormState,
} from "@/utils/sales-targets-types";

type SalesTargetFormProps = {
  mode: "create" | "edit";
  targetId?: string;
  initialEmployees: HrEmployee[];
  initialForm?: SalesTargetFormState;
  fetchError?: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function SalesTargetForm({
  mode,
  targetId,
  initialEmployees,
  initialForm,
  fetchError = null,
}: SalesTargetFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<SalesTargetFormState>(() => {
    const base = initialForm ?? emptySalesTargetForm();
    return {
      ...base,
      employee_id: resolveSelectableEmployeeId(
        initialEmployees,
        base.employee_id,
      ),
    };
  });
  const [error, setError] = useState<string | null>(fetchError);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const validationError = validateSalesTargetForm(form);
    if (validationError) {
      setError(validationError);
      setSaving(false);
      return;
    }

    const payload = buildSalesTargetPayload(form);

    if (mode === "create") {
      const { tenantId, error: tenantError } =
        await resolveSessionTenantId(supabase);
      if (tenantError || !tenantId) {
        setError(tenantError ?? "Unable to resolve workspace.");
        setSaving(false);
        return;
      }

      const { error: insertError } = await supabase
        .from("sales_targets")
        .insert({ ...payload, tenant_id: tenantId });

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }

      router.push("/dashboard/crm/sales-targets");
      router.refresh();
      return;
    }

    if (!targetId) {
      setError("Missing sales target id.");
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("sales_targets")
      .update(payload)
      .eq("id", targetId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    router.push("/dashboard/crm/sales-targets");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <SalesRepSelect
            label="Employee"
            employees={initialEmployees}
            value={form.employee_id}
            onChange={(value) =>
              setForm((current) => ({ ...current, employee_id: value }))
            }
            required
            allowEmpty={false}
            emptyLabel="Select employee"
            className={inputClassName}
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Period Type *
            </label>
            <select
              required
              value={form.period_type}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  period_type: event.target.value as SalesTargetFormState["period_type"],
                }))
              }
              className={inputClassName}
            >
              {SALES_TARGET_PERIOD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Period Start *
            </label>
            <input
              type="date"
              required
              value={form.period_start}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  period_start: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Period End *
            </label>
            <input
              type="date"
              required
              value={form.period_end}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  period_end: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Revenue Target (GHS) *
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              required
              value={form.revenue_target}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  revenue_target: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Unit Target
            </label>
            <input
              type="number"
              min={0}
              step="1"
              value={form.unit_target}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  unit_target: event.target.value,
                }))
              }
              className={inputClassName}
            />
            <p className="mt-1 text-xs text-slate-500">
              Optional count target (e.g. deals closed or units sold).
            </p>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Notes
            </label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
              }
              className={inputClassName}
            />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className={primaryButtonClassName}>
          {saving ? "Saving…" : mode === "create" ? "Create Target" : "Save Changes"}
        </button>
        <Link href="/dashboard/crm/sales-targets" className={secondaryButtonClassName}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
