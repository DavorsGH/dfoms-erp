"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import {
  LANDLORD_APPROVAL_STATUS_OPTIONS,
  LANDLORD_TYPE_OPTIONS,
  formatLandlordApprovalStatus,
  formatLandlordDate,
  formatLandlordTier,
  formatLandlordType,
  type LandlordListRow,
} from "./landlords-utils";

type LandlordsProps = {
  initialRows: LandlordListRow[];
  fetchError: string | null;
};

export default function Landlords({ initialRows, fetchError }: LandlordsProps) {
  const [rows, setRows] = useState(initialRows);
  const [error] = useState<string | null>(fetchError);
  const [filterApprovalStatus, setFilterApprovalStatus] = useState("");
  const [filterLandlordType, setFilterLandlordType] = useState("");

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (
        filterApprovalStatus &&
        (row.approvalStatus ?? "") !== filterApprovalStatus
      ) {
        return false;
      }
      if (
        filterLandlordType &&
        (row.landlordType ?? "") !== filterLandlordType
      ) {
        return false;
      }
      return true;
    });
  }, [rows, filterApprovalStatus, filterLandlordType]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <label
            htmlFor="landlord-filter-approval"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Approval Status
          </label>
          <select
            id="landlord-filter-approval"
            value={filterApprovalStatus}
            onChange={(event) => setFilterApprovalStatus(event.target.value)}
            className={inputClassName}
          >
            <option value="">All</option>
            {LANDLORD_APPROVAL_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[180px]">
          <label
            htmlFor="landlord-filter-type"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Landlord Type
          </label>
          <select
            id="landlord-filter-type"
            value={filterLandlordType}
            onChange={(event) => setFilterLandlordType(event.target.value)}
            className={inputClassName}
          >
            <option value="">All</option>
            {LANDLORD_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Name</th>
              <th className={scrollableTableThClassName}>Landlord Type</th>
              <th className={scrollableTableThClassName}>Approval Status</th>
              <th className={scrollableTableThClassName}>Subscription Tier</th>
              <th className={scrollableTableThClassName}>Created Date</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No landlords match the current filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => (
                <tr key={row.tenantId} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                    <Link
                      href={`/dashboard/real-estate/landlords/${row.tenantId}`}
                      className="hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatLandlordType(row.landlordType)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatLandlordApprovalStatus(row.approvalStatus)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {row.landlordType === "davors_managed"
                      ? "—"
                      : formatLandlordTier(row.subscriptionTier)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatLandlordDate(row.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
