"use client";

import { useRouter } from "next/navigation";
import { formatDate, formatGHS } from "./tax-ledger-utils";
import type { LinkedGraPenaltyExpense } from "./gra-penalty-expense-utils";

export function UndoRemitPenaltyNoticeDialog({
  penalty,
  onClose,
}: {
  penalty: LinkedGraPenaltyExpense;
  onClose: () => void;
}) {
  const router = useRouter();
  const dateLabel = penalty.date ? formatDate(penalty.date) : "unknown date";

  function openInExpenseRegister() {
    router.push(
      `/dashboard/finance/expenses?expenseId=${encodeURIComponent(penalty.expenseId)}`,
    );
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="undo-remit-penalty-notice-title"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h3
          id="undo-remit-penalty-notice-title"
          className="text-lg font-semibold text-[#0f2744]"
        >
          Linked penalty expense
        </h3>
        <p className="mt-3 text-sm text-slate-700">
          Linked penalty expense
          {penalty.expenses.length > 1 ? "s total" : ""} of{" "}
          {formatGHS(penalty.amount)}
          {penalty.expenses.length === 1 ? ` (${dateLabel})` : ""} for this
          period. Undoing the remittance does not remove{" "}
          {penalty.expenses.length > 1 ? "them" : "it"}.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c]"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={openInExpenseRegister}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open in Expense Register
          </button>
        </div>
      </div>
    </div>
  );
}
