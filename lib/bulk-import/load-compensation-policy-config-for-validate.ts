import type { SupabaseClient } from "@supabase/supabase-js";
import type { PayrollCompensationPolicyConfig } from "@/app/dashboard/hr-payroll/payroll-processing-utils";
import type { SalaryRateConfig } from "@/app/dashboard/employees/pay-estimate-utils";
import type {
  AllowanceTypeRow,
  CompensationPolicyRow,
} from "@/app/dashboard/administration/compensation-policy-utils";

function mapSalaryRateRow(row: Record<string, unknown>): SalaryRateConfig {
  return {
    id: String(row.id ?? ""),
    position: String(row.position ?? ""),
    employment_type: String(row.employment_type ?? ""),
    shift: String(row.shift ?? ""),
    basic_salary: Number(row.basic_salary) || 0,
    effective_date: String(row.effective_date ?? "").slice(0, 10),
  };
}

function mapAllowanceTypeRow(row: Record<string, unknown>): AllowanceTypeRow {
  return {
    id: String(row.id ?? ""),
    tenant_id: row.tenant_id ? String(row.tenant_id) : undefined,
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order) || 0,
  };
}

function mapCompensationPolicyRow(
  row: Record<string, unknown>,
): CompensationPolicyRow {
  return {
    id: String(row.id ?? ""),
    tenant_id: row.tenant_id ? String(row.tenant_id) : undefined,
    position: String(row.position ?? ""),
    employment_type: String(row.employment_type ?? ""),
    shift: String(row.shift ?? ""),
    allowance_type_id: String(row.allowance_type_id ?? ""),
    amount: Number(row.amount) || 0,
    notes: row.notes == null ? null : String(row.notes),
  };
}

/** Loads Global Salary Settings for bulk-import employee validation (Supabase). */
export async function loadCompensationPolicyConfigForValidate(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<PayrollCompensationPolicyConfig> {
  const [salaryRatesResult, allowanceTypesResult, policiesResult] =
    await Promise.all([
      supabase
        .from("salary_rate_config")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("effective_date", { ascending: false }),
      supabase
        .from("allowance_types")
        .select("id, tenant_id, code, name, is_active, sort_order")
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("compensation_policy")
        .select("*")
        .eq("tenant_id", tenantId),
    ]);

  const errors = [
    salaryRatesResult.error,
    allowanceTypesResult.error,
    policiesResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(
      errors[0]?.message ?? "Failed to load salary settings for validation.",
    );
  }

  return {
    salaryRates: (salaryRatesResult.data ?? []).map((row) =>
      mapSalaryRateRow(row as Record<string, unknown>),
    ),
    allowanceTypes: (allowanceTypesResult.data ?? []).map((row) =>
      mapAllowanceTypeRow(row as Record<string, unknown>),
    ),
    compensationPolicies: (policiesResult.data ?? []).map((row) =>
      mapCompensationPolicyRow(row as Record<string, unknown>),
    ),
  };
}
