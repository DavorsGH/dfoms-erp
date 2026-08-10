"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
} from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  formatSalesTargetEmployee,
  formatSalesTargetPeriodRange,
  formatSalesTargetPeriodType,
  formatSalesTargetRevenue,
  normalizeSalesTargetRow,
  type SalesTargetListRow,
} from "@/utils/sales-targets-types";
import type { HrEmployee } from "@/app/dashboard/hr-payroll/employee-utils";

type SalesTargetsListProps = {
  initialEmployees: HrEmployee[];
  initialTargets: SalesTargetListRow[];
  fetchError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

export default function SalesTargetsList({
  initialEmployees = [],
  initialTargets = [],
  fetchError,
}: SalesTargetsListProps) {
  const router = useRouter();
  const supabase = createClient();
  const targets = initialTargets
    .filter((row): row is SalesTargetListRow => Boolean(row?.id))
    .map(normalizeSalesTargetRow);
  const [error, setError] = useState<string | null>(fetchError);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(targetId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(targetId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("sales_targets")
      .delete()
      .eq("id", targetId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    setDeletingId(null);
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
        <Link href="/dashboard/crm/sales-targets/new" className={primaryButtonClassName}>
          New Sales Target
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Employee</th>
                <th className={scrollableTableThClassName}>Period Type</th>
                <th className={scrollableTableThClassName}>Period</th>
                <th className={scrollableTableThClassName}>Revenue Target</th>
                <th className={scrollableTableThClassName}>Unit Target</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {targets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    No sales targets yet.
                  </td>
                </tr>
              ) : (
                targets.map((target, index) => (
                  <tr
                    key={target.id}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3 text-sm">
                      {formatSalesTargetEmployee(initialEmployees, target)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatSalesTargetPeriodType(target.period_type)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatSalesTargetPeriodRange(
                        target.period_start,
                        target.period_end,
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatSalesTargetRevenue(target.revenue_target)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {target.unit_target ?? "—"}
                    </td>
                    <RegisterRowActions
                      onEdit={() => router.push(`/dashboard/crm/sales-targets/${target.id}/edit`)}
                      onDelete={() => void handleDelete(target.id)}
                      deleting={deletingId === target.id}
                    />
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
