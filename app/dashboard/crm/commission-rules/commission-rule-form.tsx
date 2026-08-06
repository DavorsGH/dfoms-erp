"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import SalesRepSelect from "@/components/sales-rep-select";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";
import type { HrEmployee } from "@/app/dashboard/hr-payroll/employee-utils";
import {
  buildCommissionRulePayload,
  emptyCommissionRuleForm,
  validateCommissionRuleForm,
  type CommissionRuleFormState,
  type CommissionRuleTargetMode,
} from "@/utils/commission-types";

type CommissionRuleFormProps = {
  mode: "create" | "edit";
  ruleId?: string;
  initialEmployees: HrEmployee[];
  positionOptions: string[];
  initialForm?: CommissionRuleFormState;
  fetchError?: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function CommissionRuleForm({
  mode,
  ruleId,
  initialEmployees,
  positionOptions,
  initialForm,
  fetchError = null,
}: CommissionRuleFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<CommissionRuleFormState>(
    initialForm ?? emptyCommissionRuleForm(),
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const validationError = validateCommissionRuleForm(form);
    if (validationError) {
      setError(validationError);
      setSaving(false);
      return;
    }

    const payload = buildCommissionRulePayload(form);

    if (mode === "create") {
      const { tenantId, error: tenantError } =
        await resolveSessionTenantId(supabase);
      if (tenantError || !tenantId) {
        setError(tenantError ?? "Unable to resolve workspace.");
        setSaving(false);
        return;
      }

      const { error: insertError } = await supabase
        .from("commission_rules")
        .insert({ ...payload, tenant_id: tenantId });

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }

      router.push("/dashboard/crm/commission-rules");
      router.refresh();
      return;
    }

    if (!ruleId) {
      setError("Missing commission rule id.");
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("commission_rules")
      .update(payload)
      .eq("id", ruleId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    router.push("/dashboard/crm/commission-rules");
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
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Rule Target *
          </label>
          <div className="flex flex-wrap gap-4">
            {(["employee", "position"] as CommissionRuleTargetMode[]).map((modeOption) => (
              <label key={modeOption} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="target_mode"
                  checked={form.target_mode === modeOption}
                  onChange={() =>
                    setForm((current) => ({
                      ...current,
                      target_mode: modeOption,
                    }))
                  }
                />
                {modeOption === "employee" ? "Specific employee" : "Position"}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Employee-specific rules take priority over position-based rules when both could apply.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {form.target_mode === "employee" ? (
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
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Position *
              </label>
              <input
                list="commission-position-options"
                required
                value={form.position}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    position: event.target.value,
                  }))
                }
                className={inputClassName}
                placeholder="e.g. Sales Representative"
              />
              <datalist id="commission-position-options">
                {positionOptions.map((position) => (
                  <option key={position} value={position} />
                ))}
              </datalist>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Commission Rate (%) *
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              required
              value={form.commission_rate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  commission_rate: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Effective Start *
            </label>
            <input
              type="date"
              required
              value={form.effective_start}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  effective_start: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Effective End
            </label>
            <input
              type="date"
              value={form.effective_end}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  effective_end: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              id="commission-rule-active"
              type="checkbox"
              checked={form.is_active}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  is_active: event.target.checked,
                }))
              }
            />
            <label htmlFor="commission-rule-active" className="text-sm text-slate-700">
              Active
            </label>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className={primaryButtonClassName}>
          {saving ? "Saving…" : mode === "create" ? "Create Rule" : "Save Changes"}
        </button>
        <Link href="/dashboard/crm/commission-rules" className={secondaryButtonClassName}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
