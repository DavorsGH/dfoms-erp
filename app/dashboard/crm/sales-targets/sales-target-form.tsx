"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAlert } from "@/components/feedback/feedback-context";
import { createClient } from "@/utils/supabase/client";
import {
  SALES_CRM_ALERT_TITLE,
  clientFacingSalesCrmError,
} from "@/lib/crm/sales-crm-notifications";
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
  const { alertError } = useAlert();
  const formRef = useRef<HTMLFormElement>(null);
  const periodEndRef = useRef<HTMLInputElement>(null);
  const unitTargetRef = useRef<HTMLInputElement>(null);
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (fetchError) {
      void alertError(clientFacingSalesCrmError(fetchError, "Could not load."), {
        title: SALES_CRM_ALERT_TITLE,
      });
    }
  }, [fetchError, alertError]);

  function applySalesTargetFormValidity(): boolean {
    periodEndRef.current?.setCustomValidity("");
    unitTargetRef.current?.setCustomValidity("");
    const employeeSelect = document.getElementById(
      "sales-target-employee",
    ) as HTMLSelectElement | null;
    employeeSelect?.setCustomValidity("");

    const validationError = validateSalesTargetForm(form);
    if (!validationError) {
      return true;
    }

    if (validationError === "Select an employee.") {
      employeeSelect?.setCustomValidity(validationError);
      employeeSelect?.reportValidity();
      return false;
    }
    if (validationError === "Period end must be on or after period start.") {
      periodEndRef.current?.setCustomValidity(validationError);
      periodEndRef.current?.reportValidity();
      return false;
    }
    if (validationError === "Unit target must be zero or greater.") {
      unitTargetRef.current?.setCustomValidity(validationError);
      unitTargetRef.current?.reportValidity();
      return false;
    }

    if (!formRef.current?.reportValidity()) {
      return false;
    }
    return true;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!applySalesTargetFormValidity()) {
      return;
    }
    if (!formRef.current?.reportValidity()) {
      return;
    }

    setSaving(true);

    const payload = buildSalesTargetPayload(form);

    if (mode === "create") {
      const { tenantId, error: tenantError } =
        await resolveSessionTenantId(supabase);
      if (tenantError || !tenantId) {
        void alertError(
          clientFacingSalesCrmError(tenantError ?? "Unable to resolve workspace."),
          { title: SALES_CRM_ALERT_TITLE },
        );
        setSaving(false);
        return;
      }

      const { error: insertError } = await supabase
        .from("sales_targets")
        .insert({ ...payload, tenant_id: tenantId });

      if (insertError) {
        void alertError(clientFacingSalesCrmError(insertError.message), {
          title: SALES_CRM_ALERT_TITLE,
        });
        setSaving(false);
        return;
      }

      router.push("/dashboard/crm/sales-targets");
      router.refresh();
      return;
    }

    if (!targetId) {
      void alertError("Missing sales target id.", {
        title: SALES_CRM_ALERT_TITLE,
      });
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("sales_targets")
      .update(payload)
      .eq("id", targetId);

    if (updateError) {
      void alertError(clientFacingSalesCrmError(updateError.message), {
        title: SALES_CRM_ALERT_TITLE,
      });
      setSaving(false);
      return;
    }

    router.push("/dashboard/crm/sales-targets");
    router.refresh();
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <SalesRepSelect
            id="sales-target-employee"
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
              ref={periodEndRef}
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
              ref={unitTargetRef}
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
