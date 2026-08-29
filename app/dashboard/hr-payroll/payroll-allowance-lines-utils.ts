import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedAllowanceLine } from "../administration/compensation-policy-utils";

export type SyncProcessingAllowanceLinesOptions = {
  /** Include on insert rows when available (matches payroll_processing upsert pattern). */
  tenantId?: string | null;
  /**
   * Stamp only brand-new processing lines. Existing lines keep their
   * business_unit_id on resave (never overwritten).
   */
  businessUnitId?: string | null;
};

type ExistingProcessingAllowanceRow = {
  id: string;
  allowance_code: string;
};

/**
 * Sync processing-stage allowance lines for one employee/month.
 *
 * Uses UPDATE existing / INSERT new — never PostgREST upsert / ON CONFLICT —
 * so a mismatched conflict target cannot block payroll. New rows stamp
 * business_unit_id; existing rows never have it overwritten.
 */
export async function syncProcessingAllowanceLines(
  supabase: SupabaseClient,
  payrollMonth: string,
  employeeId: string,
  allowances: ResolvedAllowanceLine[],
  options: SyncProcessingAllowanceLinesOptions = {},
): Promise<{ error: string | null }> {
  const month = payrollMonth.slice(0, 10);

  if (allowances.length === 0) {
    const { error: deleteError } = await supabase
      .from("payroll_allowance_lines")
      .delete()
      .eq("stage", "processing")
      .eq("payroll_month", month)
      .eq("employee_id", employeeId);

    return { error: deleteError?.message ?? null };
  }

  // Dedupe by allowance_code (policy can repeat codes).
  const dedupedByCode = new Map<string, ResolvedAllowanceLine>();
  for (const line of allowances) {
    dedupedByCode.set(line.allowance_code, line);
  }
  const dedupedAllowances = [...dedupedByCode.values()];

  const { data: existingRows, error: fetchError } = await supabase
    .from("payroll_allowance_lines")
    .select("id, allowance_code")
    .eq("stage", "processing")
    .eq("payroll_month", month)
    .eq("employee_id", employeeId);

  if (fetchError) {
    return { error: fetchError.message };
  }

  const existingByCode = new Map(
    ((existingRows as ExistingProcessingAllowanceRow[] | null) ?? []).map(
      (row) => [row.allowance_code, row],
    ),
  );
  const currentCodes = new Set(
    dedupedAllowances.map((line) => line.allowance_code),
  );

  for (const line of dedupedAllowances) {
    const amount = Math.round((Number(line.amount) || 0) * 100) / 100;
    const existing = existingByCode.get(line.allowance_code);

    if (existing) {
      const { error: updateError } = await supabase
        .from("payroll_allowance_lines")
        .update({
          allowance_type_id: line.allowance_type_id || null,
          allowance_name: line.allowance_name,
          amount,
        })
        .eq("id", existing.id);

      if (updateError) {
        return { error: updateError.message };
      }
      continue;
    }

    const insertRow: Record<string, unknown> = {
      stage: "processing",
      payroll_month: month,
      employee_id: employeeId,
      allowance_type_id: line.allowance_type_id || null,
      allowance_code: line.allowance_code,
      allowance_name: line.allowance_name,
      amount,
      business_unit_id: options.businessUnitId ?? null,
    };

    if (options.tenantId) {
      insertRow.tenant_id = options.tenantId;
    }

    const { error: insertError } = await supabase
      .from("payroll_allowance_lines")
      .insert(insertRow);

    if (insertError) {
      // Concurrent sync may have inserted first — update without touching BU.
      const isUniqueViolation =
        insertError.code === "23505" ||
        /duplicate|unique/i.test(insertError.message);
      if (!isUniqueViolation) {
        return { error: insertError.message };
      }

      let raceQuery = supabase
        .from("payroll_allowance_lines")
        .update({
          allowance_type_id: line.allowance_type_id || null,
          allowance_name: line.allowance_name,
          amount,
        })
        .eq("stage", "processing")
        .eq("payroll_month", month)
        .eq("employee_id", employeeId)
        .eq("allowance_code", line.allowance_code);

      if (options.tenantId) {
        raceQuery = raceQuery.eq("tenant_id", options.tenantId);
      }

      const { error: raceUpdateError } = await raceQuery;
      if (raceUpdateError) {
        return { error: raceUpdateError.message };
      }
    }
  }

  const staleIds = ((existingRows as ExistingProcessingAllowanceRow[] | null) ?? [])
    .filter((row) => !currentCodes.has(row.allowance_code))
    .map((row) => row.id);

  if (staleIds.length === 0) {
    return { error: null };
  }

  const { error: staleDeleteError } = await supabase
    .from("payroll_allowance_lines")
    .delete()
    .in("id", staleIds);

  return { error: staleDeleteError?.message ?? null };
}

export type PromoteAllowanceLinesToHistoryOptions = {
  /**
   * Fallback when a processing line has no business_unit_id (legacy rows).
   * Prefer copying the processing line stamp; use locker active BU only as fallback.
   */
  fallbackBusinessUnitId?: string | null;
};

/**
 * On payroll lock: copy processing lines → history, then delete processing.
 * Forward-only — never mutates existing history for other months.
 * History rows inherit each processing line's business_unit_id.
 */
export async function promoteAllowanceLinesToHistory(
  admin: SupabaseClient,
  tenantId: string,
  payrollMonth: string,
  options: PromoteAllowanceLinesToHistoryOptions = {},
): Promise<{ error: string | null }> {
  const month = payrollMonth.slice(0, 10);
  const fallbackBusinessUnitId = options.fallbackBusinessUnitId ?? null;

  const { data: processingLines, error: fetchError } = await admin
    .from("payroll_allowance_lines")
    .select(
      "allowance_type_id, allowance_code, allowance_name, amount, employee_id, business_unit_id",
    )
    .eq("tenant_id", tenantId)
    .eq("stage", "processing")
    .eq("payroll_month", month);

  if (fetchError) {
    return { error: fetchError.message };
  }

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
      business_unit_id:
        (line.business_unit_id as string | null) ?? fallbackBusinessUnitId,
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
