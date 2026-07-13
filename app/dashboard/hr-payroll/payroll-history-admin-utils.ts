import type { SupabaseClient } from "@supabase/supabase-js";

const RELEASE_SQL_SETUP_MESSAGE =
  "Run scripts/release-locked-payroll-period.sql in the Supabase SQL editor, then try again.";

export class PayrollHistoryCleanupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollHistoryCleanupError";
  }
}

export async function deletePayrollHistoryForMonth(
  admin: SupabaseClient,
  payrollMonth: string,
): Promise<number> {
  const { data: existingRows, error: fetchError } = await admin
    .from("payroll_history")
    .select("id, locked")
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
      .eq("payroll_month", payrollMonth)
      .eq("locked", true)
      .select("id");

    if (unlockError) {
      const { error: rpcError } = await admin.rpc(
        "admin_delete_payroll_history_for_month",
        { p_month: payrollMonth },
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
        { p_month: payrollMonth },
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
    .eq("payroll_month", payrollMonth)
    .select("id");

  if (deleteError) {
    if (hasProtectedRows) {
      const { error: rpcError } = await admin.rpc(
        "admin_delete_payroll_history_for_month",
        { p_month: payrollMonth },
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
      { p_month: payrollMonth },
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
): Promise<number> {
  const { count, error } = await admin
    .from("payroll_history")
    .select("id", { count: "exact", head: true })
    .eq("payroll_month", payrollMonth);

  if (error) {
    throw new PayrollHistoryCleanupError(error.message);
  }

  return count ?? 0;
}
