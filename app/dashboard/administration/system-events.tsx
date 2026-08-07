"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { getStripedRowClassName } from "../finance/register-row-actions";
import type {
  SystemEventLogRow,
  SystemEventStatus,
  SystemEventType,
} from "@/utils/system-event-log-types";

type SystemEventsViewerProps = {
  rows: SystemEventLogRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  eventTypeFilter: SystemEventType | "";
  statusFilter: SystemEventStatus | "";
  fetchError: string | null;
};

const EVENT_TYPES: Array<{ value: SystemEventType | ""; label: string }> = [
  { value: "", label: "All types" },
  { value: "webhook", label: "Webhook" },
  { value: "cron", label: "Cron" },
  { value: "payment", label: "Payment" },
];

const STATUSES: Array<{ value: SystemEventStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "success", label: "Success" },
  { value: "warning", label: "Warning" },
  { value: "failure", label: "Failure" },
];

const selectClassName =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusBadgeClass(status: SystemEventStatus): string {
  switch (status) {
    case "success":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "warning":
      return "bg-amber-50 text-amber-900 ring-amber-200";
    case "failure":
      return "bg-red-50 text-red-800 ring-red-200";
    default:
      return "bg-slate-50 text-slate-700 ring-slate-200";
  }
}

function buildHref(options: {
  page: number;
  eventType: SystemEventType | "";
  status: SystemEventStatus | "";
}): string {
  const params = new URLSearchParams();
  if (options.eventType) {
    params.set("event_type", options.eventType);
  }
  if (options.status) {
    params.set("status", options.status);
  }
  if (options.page > 1) {
    params.set("page", String(options.page));
  }
  const query = params.toString();
  return query
    ? `/dashboard/administration/system-events?${query}`
    : "/dashboard/administration/system-events";
}

export default function SystemEventsViewer({
  rows,
  totalCount,
  page,
  pageSize,
  eventTypeFilter,
  statusFilter,
  fetchError,
}: SystemEventsViewerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function updateFilters(next: {
    eventType?: SystemEventType | "";
    status?: SystemEventStatus | "";
  }) {
    const href = buildHref({
      page: 1,
      eventType: next.eventType ?? eventTypeFilter,
      status: next.status ?? statusFilter,
    });
    router.push(href);
  }

  return (
    <div className="space-y-4">
      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {fetchError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Event type
          <select
            className={selectClassName}
            value={eventTypeFilter}
            onChange={(event) =>
              updateFilters({
                eventType: event.target.value as SystemEventType | "",
              })
            }
          >
            {EVENT_TYPES.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Status
          <select
            className={selectClassName}
            value={statusFilter}
            onChange={(event) =>
              updateFilters({
                status: event.target.value as SystemEventStatus | "",
              })
            }
          >
            {STATUSES.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <p className="pb-2 text-sm text-slate-600">
          {totalCount} event{totalCount === 1 ? "" : "s"}
        </p>
      </div>

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>When</th>
              <th className={scrollableTableThClassName}>Type</th>
              <th className={scrollableTableThClassName}>Name</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No system events match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={row.id} className={getStripedRowClassName(index)}>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                    {formatTimestamp(row.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm capitalize text-slate-700">
                    {row.event_type}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {row.event_name}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass(row.status)}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="max-w-xl px-4 py-3 text-sm text-slate-700">
                    <div>{row.message ?? "—"}</div>
                    {row.metadata ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-slate-500">
                          Metadata
                        </summary>
                        <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
                          {JSON.stringify(row.metadata, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={buildHref({
                  page: page - 1,
                  eventType: eventTypeFilter,
                  status: statusFilter,
                })}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={buildHref({
                  page: page + 1,
                  eventType: eventTypeFilter,
                  status: statusFilter,
                })}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {searchParams.toString() ? (
        <p className="text-xs text-slate-500">
          Filters are reflected in the URL for sharing and refresh.
        </p>
      ) : null}
    </div>
  );
}
