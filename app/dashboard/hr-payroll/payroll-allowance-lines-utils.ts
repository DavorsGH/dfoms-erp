import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedAllowanceLine } from "../administration/compensation-policy-utils";

/**
 * Replace processing-stage allowance lines for one employee/month.
 * Forward-only: does not touch stage='history'.
 */
export async function syncProcessingAllowanceLines(
  supabase: SupabaseClient,
  payrollMonth: string,
  employeeId: string,
  allowances: ResolvedAllowanceLine[],
): Promise<{ error: string | null }> {
  const month = payrollMonth.slice(0, 10);

  const { error: deleteError } = await supabase
    .from("payroll_allowance_lines")
    .delete()
    .eq("stage", "processing")
    .eq("payroll_month", month)
    .eq("employee_id", employeeId);

  if (deleteError) {
    return { error: deleteError.message };
  }

  if (allowances.length === 0) {
    return { error: null };
  }

  const rows = allowances.map((line) => ({
    stage: "processing" as const,
    payroll_month: month,
    employee_id: employeeId,
    allowance_type_id: line.allowance_type_id || null,
    allowance_code: line.allowance_code,
    allowance_name: line.allowance_name,
    amount: Math.round((Number(line.amount) || 0) * 100) / 100,
  }));

  const { error: insertError } = await supabase
    .from("payroll_allowance_lines")
    .insert(rows);

  return { error: insertError?.message ?? null };
}

/**
 * On payroll lock: copy processing lines → history, then delete processing.
 * Forward-only — never mutates existing history for other months.
 */
export async function promoteAllowanceLinesToHistory(
  admin: SupabaseClient,
  tenantId: string,
  payrollMonth: string,
): Promise<{ error: string | null }> {
  const month = payrollMonth.slice(0, 10);

  const { data: processingLines, error: fetchError } = await admin
    .from("payroll_allowance_lines")
    .select(
      "allowance_type_id, allowance_code, allowance_name, amount, employee_id",
    )
    .eq("tenant_id", tenantId)
    .eq("stage", "processing")
    .eq("payroll_month", month);

  if (fetchError) {
    return { error: fetchError.message };
  }

  // Clear any prior history snapshot for this month (re-lock safety).
  const { error: clearHistoryError } = await admin
    .from("payroll_allowance_lines")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("stage", "history")
    .eq("payroll_month", month);

  if (clearHistoryError) {
    return { error: clearHistoryError.message };
  }

  if ((processingLines?.length ?? 0) > 0) {
    const historyRows = (processingLines ?? []).map((line) => ({
      tenant_id: tenantId,
      stage: "history" as const,
      payroll_month: month,
      employee_id: line.employee_id,
      allowance_type_id: line.allowance_type_id,
      allowance_code: line.allowance_code,
      allowance_name: line.allowance_name,
      amount: Number(line.amount) || 0,
    }));

    const { error: insertError } = await admin
      .from("payroll_allowance_lines")
      .insert(historyRows);

    if (insertError) {
      return { error: insertError.message };
    }
  }

  const { error: deleteProcessingError } = await admin
    .from("payroll_allowance_lines")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("stage", "processing")
    .eq("payroll_month", month);

  return { error: deleteProcessingError?.message ?? null };
}
