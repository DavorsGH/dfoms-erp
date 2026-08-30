import type { SupabaseClient } from "@supabase/supabase-js";

const RELEASE_SQL_SETUP_MESSAGE =
  "Run scripts/release-locked-payroll-period.sql in the Supabase SQL editor, then try again.";

export class PayrollHistoryCleanupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollHistoryCleanupError";
  }
}

export type DeletePayrollHistoryOptions = {
  /**
   * When set, only these employees' history rows are deleted.
   * Never calls the tenant-wide admin RPC — other BUs stay intact.
   */
  employeeIds?: string[];
};

/**
 * Delete payroll_history for a month.
 * Pass `employeeIds` for lock/release/reopen BU scope (required for multi-BU safety).
 * Omit only for legacy tenant-wide repair paths that already refuse when any BU is locked.
 */
export async function deletePayrollHistoryForMonth(
  admin: SupabaseClient,
  payrollMonth: string,
  tenantId: string,
  options?: DeletePayrollHistoryOptions,
): Promise<number> {
  const employeeIds = options?.employeeIds;

  if (employeeIds !== undefined) {
    return deletePayrollHistoryForEmployeesInMonth(
      admin,
      payrollMonth,
      tenantId,
      employeeIds,
    );
  }

  const { data: existingRows, error: fetchError } = await admin
    .from("payroll_history")
    .select("id, locked")
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);

  if (fetchError) {
    throw new PayrollHistoryCleanupError(fetchError.message);
  }

  const rows = existingRows ?? [];
  if (rows.length === 0) {
    return 0;
  }

  const hasProtectedRows = rows.some((row) => row.locked === true);

  if (hasProtectedRows) {
    const { data: unlockedRows, error: unlockError } = await admin
      .from("payroll_history")
      .update({ locked: false })
      .eq("tenant_id", tenantId)
      .eq("payroll_month", payrollMonth)
      .eq("locked", true)
      .select("id");

    if (unlockError) {
      const { error: rpcError } = await admin.rpc(
        "admin_delete_payroll_history_for_month",
        { p_month: payrollMonth, p_tenant_id: tenantId },
      );

      if (rpcError) {
        const message = rpcError.message.includes(
          "admin_delete_payroll_history_for_month",
        )
          ? RELEASE_SQL_SETUP_MESSAGE
          : rpcError.message;

        throw new PayrollHistoryCleanupError(message);
      }

      return rows.length;
    }

    if ((unlockedRows ?? []).length === 0) {
      const { error: rpcError } = await admin.rpc(
        "admin_delete_payroll_history_for_month",
        { p_month: payrollMonth, p_tenant_id: tenantId },
      );

      if (rpcError) {
        const message = rpcError.message.includes(
          "admin_delete_payroll_history_for_month",
        )
          ? RELEASE_SQL_SETUP_MESSAGE
          : rpcError.message;

        throw new PayrollHistoryCleanupError(message);
      }

      return rows.length;
    }
  }

  const { data: deletedRows, error: deleteError } = await admin
    .from("payroll_history")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth)
    .select("id");

  if (deleteError) {
    if (hasProtectedRows) {
      const { error: rpcError } = await admin.rpc(
        "admin_delete_payroll_history_for_month",
        { p_month: payrollMonth, p_tenant_id: tenantId },
      );

      if (rpcError) {
        const message = rpcError.message.includes(
          "admin_delete_payroll_history_for_month",
        )
          ? RELEASE_SQL_SETUP_MESSAGE
          : rpcError.message;

        throw new PayrollHistoryCleanupError(message);
      }

      return rows.length;
    }

    throw new PayrollHistoryCleanupError(deleteError.message);
  }

  const deletedCount = deletedRows?.length ?? 0;
  if (deletedCount === 0 && rows.length > 0) {
    const { error: rpcError } = await admin.rpc(
      "admin_delete_payroll_history_for_month",
      { p_month: payrollMonth, p_tenant_id: tenantId },
    );

    if (rpcError) {
      const message = rpcError.message.includes(
        "admin_delete_payroll_history_for_month",
      )
        ? RELEASE_SQL_SETUP_MESSAGE
        : rpcError.message;

      throw new PayrollHistoryCleanupError(message);
    }

    return rows.length;
  }

  const remainingCount = await countPayrollHistoryRowsForMonth(
    admin,
    payrollMonth,
    tenantId,
  );

  if (remainingCount > 0) {
    throw new PayrollHistoryCleanupError(
      `${remainingCount} payroll history row(s) could not be removed. ${RELEASE_SQL_SETUP_MESSAGE}`,
    );
  }

  return deletedCount;
}

export async function countPayrollHistoryRowsForMonth(
  admin: SupabaseClient,
  payrollMonth: string,
  tenantId: string,
  employeeIds?: string[],
): Promise<number> {
  let query = admin
    .from("payroll_history")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);

  if (employeeIds !== undefined) {
    if (employeeIds.length === 0) {
      return 0;
    }
    query = query.in("employee_id", employeeIds);
  }

  const { count, error } = await query;

  if (error) {
    throw new PayrollHistoryCleanupError(error.message);
  }

  return count ?? 0;
}

/**
 * Delete payroll_history for a month limited to specific employees (one BU
 * scope). Does not call the tenant-wide admin RPC — other BUs' rows stay intact.
 */
export async function deletePayrollHistoryForEmployeesInMonth(
  admin: SupabaseClient,
  payrollMonth: string,
  tenantId: string,
  employeeIds: string[],
): Promise<number> {
  if (employeeIds.length === 0) {
    return 0;
  }

  const { data: existingRows, error: fetchError } = await admin
    .from("payroll_history")
    .select("id, locked")
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth)
    .in("employee_id", employeeIds);

  if (fetchError) {
    throw new PayrollHistoryCleanupError(fetchError.message);
  }

  const rows = existingRows ?? [];
  if (rows.length === 0) {
    return 0;
  }

  if (rows.some((row) => row.locked === true)) {
    // Protect trigger may reject unlock; RPC fallback below disables it.
    await admin
      .from("payroll_history")
      .update({ locked: false })
      .eq("tenant_id", tenantId)
      .eq("payroll_month", payrollMonth)
      .in("employee_id", employeeIds)
      .eq("locked", true);
  }

  const { data: deletedRows, error: deleteError } = await admin
    .from("payroll_history")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth)
    .in("employee_id", employeeIds)
    .select("id");

  // Protect trigger may error or silently skip DELETE; use scoped SECURITY DEFINER RPC.
  let deletedCount = deleteError ? 0 : (deletedRows?.length ?? 0);
  let remainingScoped = await countPayrollHistoryRowsForMonth(
    admin,
    payrollMonth,
    tenantId,
    employeeIds,
  );

  if (remainingScoped > 0 || deleteError) {
    const { data: rpcDeleted, error: rpcError } = await admin.rpc(
      "admin_delete_payroll_history_for_employees",
      {
        p_month: payrollMonth,
        p_tenant_id: tenantId,
        p_employee_ids: employeeIds,
      },
    );

    if (rpcError) {
      const message = rpcError.message.includes(
        "admin_delete_payroll_history_for_employees",
      )
        ? `${remainingScoped} scoped payroll history row(s) could not be removed. Run scripts/266_admin_delete_payroll_history_for_employees.sql in the Supabase SQL editor, then try again.`
        : rpcError.message;
      throw new PayrollHistoryCleanupError(message);
    }

    deletedCount = Number(rpcDeleted ?? deletedCount);
    remainingScoped = await countPayrollHistoryRowsForMonth(
      admin,
      payrollMonth,
      tenantId,
      employeeIds,
    );
  }

  if (remainingScoped > 0) {
    throw new PayrollHistoryCleanupError(
      `${remainingScoped} scoped payroll history row(s) could not be removed.`,
    );
  }

  return deletedCount;
}
