"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";
import { getStripedRowClassName } from "../finance/register-row-actions";
import {
  formatSupportTicketStatus,
  SUPPORT_TICKET_STATUSES,
  type SupportTicketListRow,
  type SupportTicketStatus,
} from "@/utils/support-tickets-types";

type TenantOption = {
  tenantId: string;
  companyName: string;
};

type SupportTicketsAdminProps = {
  rows: SupportTicketListRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  statusFilter: SupportTicketStatus | "";
  tenantFilter: string;
  tenantOptions: TenantOption[];
  selectedTicketId: string | null;
  fetchError: string | null;
};

const selectClassName =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: SupportTicketStatus): string {
  switch (status) {
    case "open":
      return "bg-blue-50 text-blue-800 ring-blue-200";
    case "in_progress":
      return "bg-amber-50 text-amber-900 ring-amber-200";
    case "resolved":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "closed":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    default:
      return "bg-slate-50 text-slate-700 ring-slate-200";
  }
}

function buildHref(options: {
  page: number;
  status: SupportTicketStatus | "";
  tenantId: string;
  ticketId?: string | null;
}): string {
  const params = new URLSearchParams();
  if (options.status) {
    params.set("status", options.status);
  }
  if (options.tenantId) {
    params.set("tenant_id", options.tenantId);
  }
  if (options.page > 1) {
    params.set("page", String(options.page));
  }
  if (options.ticketId) {
    params.set("ticket", options.ticketId);
  }
  const query = params.toString();
  return query
    ? `/dashboard/administration/support-tickets?${query}`
    : "/dashboard/administration/support-tickets";
}

export default function SupportTicketsAdmin({
  rows,
  totalCount,
  page,
  pageSize,
  statusFilter,
  tenantFilter,
  tenantOptions,
  selectedTicketId,
  fetchError,
}: SupportTicketsAdminProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const selectedTicket = useMemo(
    () => rows.find((row) => row.id === selectedTicketId) ?? null,
    [rows, selectedTicketId],
  );

  const [status, setStatus] = useState<SupportTicketStatus>(
    selectedTicket?.status ?? "open",
  );
  const [resolutionNotes, setResolutionNotes] = useState(
    selectedTicket?.resolution_notes ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setStatus(selectedTicket?.status ?? "open");
    setResolutionNotes(selectedTicket?.resolution_notes ?? "");
    setSuccessMessage(null);
  }, [selectedTicket]);

  function updateFilters(next: { status?: SupportTicketStatus | ""; tenantId?: string }) {
    router.push(
      buildHref({
        page: 1,
        status: next.status ?? statusFilter,
        tenantId: next.tenantId ?? tenantFilter,
        ticketId: selectedTicketId,
      }),
    );
  }

  async function handleSave() {
    if (!selectedTicket) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/admin/support-tickets/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_id: selectedTicket.id,
          status,
          resolution_notes: resolutionNotes,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to update ticket.");
      }

      setSuccessMessage("Ticket updated.");
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to update ticket.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {successMessage ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {successMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Status
          <select
            className={selectClassName}
            value={statusFilter}
            onChange={(event) =>
              updateFilters({
                status: event.target.value as SupportTicketStatus | "",
              })
            }
          >
            <option value="">All statuses</option>
            {SUPPORT_TICKET_STATUSES.map((value) => (
              <option key={value} value={value}>
                {formatSupportTicketStatus(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Tenant
          <select
            className={selectClassName}
            value={tenantFilter}
            onChange={(event) => updateFilters({ tenantId: event.target.value })}
          >
            <option value="">All tenants</option>
            {tenantOptions.map((tenant) => (
              <option key={tenant.tenantId} value={tenant.tenantId}>
                {tenant.companyName}
              </option>
            ))}
          </select>
        </label>

        <FilteredListCount
          filteredCount={totalCount}
          totalCount={totalCount}
          itemSingular="ticket"
          hasActiveFilters={Boolean(statusFilter || tenantFilter)}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>When</th>
                <th className={scrollableTableThClassName}>Tenant</th>
                <th className={scrollableTableThClassName}>Subject</th>
                <th className={scrollableTableThClassName}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No support tickets match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const active = row.id === selectedTicketId;
                  return (
                    <tr
                      key={row.id}
                      className={`${getStripedRowClassName(index)} ${active ? "bg-sky-50" : ""}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                        {formatTimestamp(row.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.tenant_name ?? row.tenant_id}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Link
                          href={buildHref({
                            page,
                            status: statusFilter,
                            tenantId: tenantFilter,
                            ticketId: row.id,
                          })}
                          className="font-medium text-[#0f2744] hover:underline"
                        >
                          {row.subject}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass(row.status)}`}
                        >
                          {formatSupportTicketStatus(row.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollableTable>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          {selectedTicket ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-[#0f2744]">
                  {selectedTicket.subject}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedTicket.tenant_name ?? selectedTicket.tenant_id} ·{" "}
                  {formatTimestamp(selectedTicket.created_at)}
                </p>
              </div>

              <div>
                <p className="mb-1 text-sm font-medium text-slate-700">Description</p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {selectedTicket.description}
                </p>
              </div>

              <label className="block space-y-1 text-sm text-slate-700">
                Status
                <select
                  className={selectClassName}
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as SupportTicketStatus)
                  }
                >
                  {SUPPORT_TICKET_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {formatSupportTicketStatus(value)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1 text-sm text-slate-700">
                Resolution notes
                <textarea
                  className={`${inputClassName} min-h-28`}
                  value={resolutionNotes}
                  onChange={(event) => setResolutionNotes(event.target.value)}
                  placeholder="Notes visible to the tenant once resolved."
                />
              </label>

              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16365c] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              Select a ticket from the list to review and update it.
            </p>
          )}
        </div>
      </div>

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
                  status: statusFilter,
                  tenantId: tenantFilter,
                  ticketId: selectedTicketId,
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
                  status: statusFilter,
                  tenantId: tenantFilter,
                  ticketId: selectedTicketId,
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
          Filters and selected ticket are reflected in the URL for sharing and refresh.
        </p>
      ) : null}
    </div>
  );
}
