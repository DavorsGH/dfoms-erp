"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useAlert } from "@/components/feedback/feedback-context";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  SALES_CRM_ALERT_TITLE,
  clientFacingSalesCrmError,
} from "@/lib/crm/sales-crm-notifications";
import {
  discountRuleActiveBadgeClassName,
  formatDiscountAppliesTo,
  formatDiscountDateRange,
  formatDiscountType,
  formatDiscountUsage,
  formatDiscountValue,
  normalizeDiscountRuleRow,
  type DiscountRuleListRow,
} from "@/utils/discount-rules-types";

type DiscountsListProps = {
  initialRules: DiscountRuleListRow[];
  fetchError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

export default function DiscountsList({
  initialRules,
  fetchError,
}: DiscountsListProps) {
  const { alertError } = useAlert();
  const rules = initialRules.map(normalizeDiscountRuleRow);

  useEffect(() => {
    if (fetchError) {
      void alertError(clientFacingSalesCrmError(fetchError, "Could not load."), {
        title: SALES_CRM_ALERT_TITLE,
      });
    }
  }, [fetchError, alertError]);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Link href="/dashboard/crm/discounts/new" className={primaryButtonClassName}>
          New Discount Rule
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Code</th>
                <th className={scrollableTableThClassName}>Name</th>
                <th className={scrollableTableThClassName}>Type / Value</th>
                <th className={scrollableTableThClassName}>Applies To</th>
                <th className={scrollableTableThClassName}>Usage</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Date Range</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rules.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No discount rules yet.
                  </td>
                </tr>
              ) : (
                rules.map((rule, index) => (
                  <tr key={rule.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {rule.code}
                    </td>
                    <td className="px-4 py-3">{rule.name}</td>
                    <td className="px-4 py-3">
                      {formatDiscountType(rule.discount_type)} ·{" "}
                      {formatDiscountValue(rule)}
                    </td>
                    <td className="px-4 py-3">
                      {formatDiscountAppliesTo(rule.applies_to)}
                    </td>
                    <td className="px-4 py-3">{formatDiscountUsage(rule)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${discountRuleActiveBadgeClassName(rule.is_active)}`}
                      >
                        {rule.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {formatDiscountDateRange(rule.start_date, rule.end_date)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/crm/discounts/${rule.id}/edit`}
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
