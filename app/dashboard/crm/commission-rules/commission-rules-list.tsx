"use client";

import Link from "next/link";
import { useState } from "react";
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
  "rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

export default function CommissionRulesList({
  initialEmployees,
  initialRules,
  fetchError,
}: CommissionRulesListProps) {
  const rules = initialRules.map(normalizeCommissionRuleRow);
  const [error] = useState<string | null>(fetchError);

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
                      <Link
                        href={`/dashboard/crm/commission-rules/${rule.id}/edit`}
                        className={secondaryButtonClassName}
                      >
                        Edit
                      </Link>
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
