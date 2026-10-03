import "server-only";

import type { Client } from "pg";
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

/** Loads Global Salary Settings tables for bulk-import employee commit (pg transaction). */
export async function loadCompensationPolicyConfigForCommit(
  client: Client,
  tenantId: string,
): Promise<PayrollCompensationPolicyConfig> {
  const [salaryRatesResult, allowanceTypesResult, policiesResult] =
    await Promise.all([
      client.query(
        `
          SELECT *
          FROM public.salary_rate_config
          WHERE tenant_id = $1
          ORDER BY effective_date DESC
        `,
        [tenantId],
      ),
      client.query(
        `
          SELECT id, tenant_id, code, name, is_active, sort_order
          FROM public.allowance_types
          WHERE tenant_id = $1
          ORDER BY sort_order ASC, name ASC
        `,
        [tenantId],
      ),
      client.query(
        `
          SELECT *
          FROM public.compensation_policy
          WHERE tenant_id = $1
        `,
        [tenantId],
      ),
    ]);

  return {
    salaryRates: salaryRatesResult.rows.map((row) =>
      mapSalaryRateRow(row as Record<string, unknown>),
    ),
    allowanceTypes: allowanceTypesResult.rows.map((row) =>
      mapAllowanceTypeRow(row as Record<string, unknown>),
    ),
    compensationPolicies: policiesResult.rows.map((row) =>
      mapCompensationPolicyRow(row as Record<string, unknown>),
    ),
  };
}
