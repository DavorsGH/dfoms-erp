"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
  scrollableTableWrapTdClassName,
  scrollableTableWrapThClassName,
} from "@/app/dashboard/scrollable-table";
import FilteredListCount from "@/app/dashboard/filtered-list-count";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import type {
  UserActivityLogRow,
  UserActivityPersona,
  UserActivityStatus,
} from "@/utils/user-activity-log-types";
import { formatUserActivityEventLabel } from "@/utils/user-activity-log-types";

type TenantOption = { id: string; name: string };

type UserActivityLogViewerProps = {
  rows: UserActivityLogRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  personaFilter: UserActivityPersona | "";
  statusFilter: UserActivityStatus | "";
  tenantFilter: string;
  dateFrom: string;
  dateTo: string;
  fetchError: string | null;
  basePath: string;
  showTenantFilter?: boolean;
  tenantOptions?: TenantOption[];
};

const PERSONAS: Array<{ value: UserActivityPersona | ""; label: string }> = [
  { value: "", label: "All personas" },
  { value: "staff", label: "Staff" },
  { value: "lessee", label: "Lessee" },
  { value: "landlord", label: "Landlord" },
];

const STATUSES: Array<{ value: UserActivityStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "success", label: "Success" },
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

function statusBadgeClass(status: UserActivityStatus): string {
  return status === "success"
    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
    : "bg-red-50 text-red-800 ring-red-200";
}

function formatDetail(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "—";
  const parts: string[] = [];
  if (typeof metadata.method === "string") {
    parts.push(`Method: ${metadata.method.replace(/_/g, " ")}`);
  }
  if (typeof metadata.failure_reason === "string") {
    parts.push(metadata.failure_reason);
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function buildHref(
  basePath: string,
  options: {
    page: number;
    persona: UserActivityPersona | "";
    status: UserActivityStatus | "";
    tenantId: string;
    dateFrom: string;
    dateTo: string;
  },
): string {
  const params = new URLSearchParams();
  if (options.persona) params.set("persona", options.persona);
  if (options.status) params.set("status", options.status);
  if (options.tenantId) params.set("tenant_id", options.tenantId);
  if (options.dateFrom) params.set("date_from", options.dateFrom);
  if (options.dateTo) params.set("date_to", options.dateTo);
  if (options.page > 1) params.set("page", String(options.page));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export default function UserActivityLogViewer({
  rows,
  totalCount,
  page,
  pageSize,
  personaFilter,
  statusFilter,
  tenantFilter,
  dateFrom,
  dateTo,
  fetchError,
  basePath,
  showTenantFilter = false,
  tenantOptions = [],
}: UserActivityLogViewerProps) {
  const router = useRouter();
  const tenantNameById = new Map(tenantOptions.map((t) => [t.id, t.name]));
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function applyFilters(next: Partial<{
    persona: UserActivityPersona | "";
    status: UserActivityStatus | "";
    tenantId: string;
    dateFrom: string;
    dateTo: string;
  }>) {
    const href = buildHref(basePath, {
      page: 1,
      persona: next.persona ?? personaFilter,
      status: next.status ?? statusFilter,
      tenantId: next.tenantId ?? tenantFilter,
      dateFrom: next.dateFrom ?? dateFrom,
      dateTo: next.dateTo ?? dateTo,
    });
    router.push(href);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Persona
          <select
            className={selectClassName}
            value={personaFilter}
            onChange={(e) =>
              applyFilters({
                persona: e.target.value as UserActivityPersona | "",
              })
            }
          >
            {PERSONAS.map((option) => (
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
            onChange={(e) =>
              applyFilters({
                status: e.target.value as UserActivityStatus | "",
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

        {showTenantFilter && (
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Tenant
            <select
              className={selectClassName}
              value={tenantFilter}
              onChange={(e) => applyFilters({ tenantId: e.target.value })}
            >
              <option value="">All tenants</option>
              {tenantOptions.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm text-slate-700">
          From
          <input
            type="date"
            className={selectClassName}
            value={dateFrom}
            onChange={(e) => applyFilters({ dateFrom: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-700">
          To
          <input
            type="date"
            className={selectClassName}
            value={dateTo}
            onChange={(e) => applyFilters({ dateTo: e.target.value })}
          />
        </label>
      </div>

      <FilteredListCount
        filteredCount={totalCount}
        totalCount={totalCount}
        itemSingular="login event"
      />

      {fetchError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not load login activity: {fetchError}
        </p>
      )}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableWrapThClassName}>When</th>
              {showTenantFilter && (
                <th className={scrollableTableWrapThClassName}>Tenant</th>
              )}
              <th className={scrollableTableThClassName}>Persona</th>
              <th className={scrollableTableWrapThClassName}>User</th>
              <th className={scrollableTableWrapThClassName}>Event</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableWrapThClassName}>Detail</th>
              <th className={scrollableTableWrapThClassName}>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={showTenantFilter ? 8 : 7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No login events match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={getStripedRowClassName(index)}
                >
                  <td className={scrollableTableWrapTdClassName}>
                    {formatTimestamp(row.created_at)}
                  </td>
                  {showTenantFilter && (
                    <td className={scrollableTableWrapTdClassName}>
                      {row.tenant_id
                        ? tenantNameById.get(row.tenant_id) ?? row.tenant_id
                        : "—"}
                    </td>
                  )}
                  <td className={scrollableTableWrapTdClassName}>
                    {row.persona}
                  </td>
                  <td className={scrollableTableWrapTdClassName}>
                    {row.email ?? "—"}
                  </td>
                  <td className={scrollableTableWrapTdClassName}>
                    {formatUserActivityEventLabel(row.event_name)}
                  </td>
                  <td className={scrollableTableWrapTdClassName}>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass(row.status)}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className={scrollableTableWrapTdClassName}>
                    {formatDetail(row.metadata)}
                  </td>
                  <td className={scrollableTableWrapTdClassName}>
                    {row.ip ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildHref(basePath, {
                  page: page - 1,
                  persona: personaFilter,
                  status: statusFilter,
                  tenantId: tenantFilter,
                  dateFrom,
                  dateTo,
                })}
                className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={buildHref(basePath, {
                  page: page + 1,
                  persona: personaFilter,
                  status: statusFilter,
                  tenantId: tenantFilter,
                  dateFrom,
                  dateTo,
                })}
                className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
