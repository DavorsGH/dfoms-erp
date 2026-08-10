"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  formatCommissionRate,
  formatCommissionRuleTarget,
  normalizeCommissionRuleRow,
  type CommissionRuleListRow,
} from "@/utils/commission-types";
import type { HrEmployee } from "@/app/dashboard/hr-payroll/employee-utils";

type CommissionRulesListProps = {
  initialEmployees: HrEmployee[];
  initialRules: CommissionRuleListRow[];
  fetchError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function CommissionRulesList({
  initialEmployees,
  initialRules,
  fetchError,
}: CommissionRulesListProps) {
  const router = useRouter();
  const supabase = createClient();
  const [rules, setRules] = useState(
    initialRules.map(normalizeCommissionRuleRow),
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [deleteTarget, setDeleteTarget] = useState<CommissionRuleListRow | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setRules(initialRules.map(normalizeCommissionRuleRow));
  }, [initialRules]);

  async function handleDeleteRule() {
    if (!deleteTarget) {
      return;
    }

    setDeleting(true);
    setError(null);

    const { error: deleteError } = await supabase
      .from("commission_rules")
      .delete()
      .eq("id", deleteTarget.id);

    if (deleteError) {
      setError(deleteError.message);
      setDeleting(false);
      return;
    }

    setRules((current) => current.filter((rule) => rule.id !== deleteTarget.id));
    setDeleteTarget(null);
    setDeleting(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Link href="/dashboard/crm/commission-rules/new" className={primaryButtonClassName}>
          New Commission Rule
        </Link>
      </div>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-commission-rule-title"
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h3
              id="delete-commission-rule-title"
              className="text-lg font-semibold text-[#0f2744]"
            >
              Delete commission rule?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This permanently removes the rule for{" "}
              <span className="font-medium text-slate-800">
                {formatCommissionRuleTarget(initialEmployees, deleteTarget)}
              </span>{" "}
              ({formatCommissionRate(deleteTarget.commission_rate)}). Existing
              commission calculations keep their saved rate snapshot and are not
              affected. To stop future use without deleting, use Edit and uncheck
              Active instead.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className={secondaryButtonClassName}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteRule()}
                disabled={deleting}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Target</th>
                <th className={scrollableTableThClassName}>Rate</th>
                <th className={scrollableTableThClassName}>Effective</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    No commission rules yet.
                  </td>
                </tr>
              ) : (
                rules.map((rule, index) => (
                  <tr key={rule.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 text-sm">
                      {formatCommissionRuleTarget(initialEmployees, rule)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatCommissionRate(rule.commission_rate)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {rule.effective_start.slice(0, 10)}
                      {rule.effective_end
                        ? ` – ${rule.effective_end.slice(0, 10)}`
                        : " – open"}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {rule.is_active ? "Active" : "Inactive"}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/dashboard/crm/commission-rules/${rule.id}/edit`}
                          className={secondaryButtonClassName}
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(rule)}
                          className={dangerButtonClassName}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>
    </div>
  );
}
