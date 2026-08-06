"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";
import {
  DISCOUNT_APPLIES_TO,
  DISCOUNT_TYPES,
  buildDiscountRulePayload,
  emptyDiscountRuleForm,
  discountRuleToFormState,
  type DiscountRuleFormState,
  type DiscountRuleListRow,
} from "@/utils/discount-rules-types";

type DiscountRuleFormProps = {
  mode: "create" | "edit";
  ruleId?: string;
  initialForm?: DiscountRuleFormState;
  usageCount?: number;
  fetchError?: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function DiscountRuleForm({
  mode,
  ruleId,
  initialForm,
  usageCount = 0,
  fetchError = null,
}: DiscountRuleFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<DiscountRuleFormState>(
    initialForm ?? emptyDiscountRuleForm(),
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    if (!form.code.trim()) {
      setError("Code is required.");
      setSaving(false);
      return;
    }

    if (!form.name.trim()) {
      setError("Name is required.");
      setSaving(false);
      return;
    }

    const payload = buildDiscountRulePayload(form);

    if (mode === "create") {
      const { tenantId, error: tenantError } =
        await resolveSessionTenantId(supabase);
      if (tenantError || !tenantId) {
        setError(tenantError ?? "Unable to resolve workspace.");
        setSaving(false);
        return;
      }

      const { error: insertError } = await supabase
        .from("discount_rules")
        .insert({ ...payload, tenant_id: tenantId });

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }

      router.push("/dashboard/crm/discounts");
      router.refresh();
      return;
    }

    if (!ruleId) {
      setError("Missing discount rule id.");
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("discount_rules")
      .update(payload)
      .eq("id", ruleId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    router.push("/dashboard/crm/discounts");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {mode === "edit" ? (
        <p className="text-sm text-slate-600">
          Times used: {usageCount}
        </p>
      ) : null}

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Code *
          </label>
          <input
            type="text"
            required
            value={form.code}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                code: event.target.value.toUpperCase(),
              }))
            }
            className={inputClassName}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Name *
          </label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            className={inputClassName}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Discount Type *
          </label>
          <select
            value={form.discount_type}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                discount_type: event.target.value as DiscountRuleListRow["discount_type"],
              }))
            }
            className={inputClassName}
          >
            {DISCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type === "fixed" ? "Fixed amount (GHS)" : "Percentage"}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Percentage takes a % off the order. Fixed takes a flat GHS amount off.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Discount Value *
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            required
            value={form.discount_value}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                discount_value: Number.parseFloat(event.target.value) || 0,
              }))
            }
            className={inputClassName}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Applies To *
          </label>
          <select
            value={form.applies_to}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                applies_to: event.target.value as DiscountRuleListRow["applies_to"],
              }))
            }
            className={inputClassName}
          >
            {DISCOUNT_APPLIES_TO.map((value) => (
              <option key={value} value={value}>
                {value === "product_sale"
                  ? "Product Sale"
                  : value === "invoice"
                    ? "Invoice"
                    : "Both"}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Which sale types this code can be used on.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Minimum Order Amount (GHS)
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.min_order_amount}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                min_order_amount: event.target.value,
              }))
            }
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-slate-500">
            The order must total at least this amount for the code to apply. Leave
            blank for no minimum.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Start Date
          </label>
          <input
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
          <p className="mt-1 text-xs text-slate-500">
            The code is only valid within this date range. Leave both blank for no
            expiry.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Usage Limit
          </label>
          <input
            type="number"
            min={0}
            step="1"
            value={form.usage_limit}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                usage_limit: event.target.value,
              }))
            }
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-slate-500">
            Total number of times this code can be used across all customers
            combined. Leave blank for unlimited.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Per Customer Limit
          </label>
          <input
            type="number"
            min={0}
            step="1"
            value={form.per_customer_limit}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                per_customer_limit: event.target.value,
              }))
            }
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-slate-500">
            How many times a single customer can use this code. Leave blank for
            unlimited.
          </p>
        </div>
        <div className="flex items-center gap-2 md:col-span-2">
          <input
            id="discount-is-active"
            type="checkbox"
            checked={form.is_active}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                is_active: event.target.checked,
              }))
            }
            className="h-4 w-4 rounded border-slate-300"
          />
          <label htmlFor="discount-is-active" className="text-sm text-slate-700">
            Active
          </label>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className={primaryButtonClassName}>
          {saving ? "Saving…" : mode === "create" ? "Create Rule" : "Save Changes"}
        </button>
        <Link href="/dashboard/crm/discounts" className={secondaryButtonClassName}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
