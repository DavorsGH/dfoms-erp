"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { getStripedRowClassName } from "../finance/register-row-actions";
import {
  formatSupportTicketStatus,
  type SupportTicketRow,
  type SupportTicketStatus,
} from "@/utils/support-tickets-types";

type ReportTab = "report" | "my-reports";

type ReportAProblemProps = {
  initialTickets: SupportTicketRow[];
  fetchError: string | null;
  initialTab: ReportTab;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const tabClassName = (active: boolean) =>
  `rounded-md px-4 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-[#0f2744] text-white"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
  }`;

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

export default function ReportAProblem({
  initialTickets,
  fetchError,
  initialTab,
}: ReportAProblemProps) {
  const router = useRouter();
  const [tab, setTab] = useState<ReportTab>(initialTab);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/support-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, description }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to submit support ticket.");
      }

      setSubject("");
      setDescription("");
      setSuccessMessage("Your report was submitted. Davors support will review it soon.");
      setTab("my-reports");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to submit support ticket.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={tabClassName(tab === "report")} onClick={() => setTab("report")}>
          Report a Problem
        </button>
        <button
          type="button"
          className={tabClassName(tab === "my-reports")}
          onClick={() => setTab("my-reports")}
        >
          My Reports
        </button>
      </div>

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

      {tab === "report" ? (
        <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
          <p className="text-sm text-slate-600">
            Describe the issue you are experiencing. Davors support will be notified
            immediately.
          </p>

          <label className="block space-y-1 text-sm text-slate-700">
            Subject
            <input
              className={inputClassName}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={200}
              required
              placeholder="Brief summary of the problem"
            />
          </label>

          <label className="block space-y-1 text-sm text-slate-700">
            Description
            <textarea
              className={`${inputClassName} min-h-40`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={8000}
              required
              placeholder="Steps to reproduce, error messages, affected module, etc."
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16365c] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit Report"}
          </button>
        </form>
      ) : (
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Submitted</th>
                <th className={scrollableTableThClassName}>Subject</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {initialTickets.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    You have not submitted any support reports yet.
                  </td>
                </tr>
              ) : (
                initialTickets.map((ticket, index) => (
                  <tr key={ticket.id} className={getStripedRowClassName(index)}>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                      {formatTimestamp(ticket.created_at)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900">
                      <div className="font-medium">{ticket.subject}</div>
                      <div className="mt-1 text-xs text-slate-500">{ticket.description}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass(ticket.status)}`}
                      >
                        {formatSupportTicketStatus(ticket.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {ticket.resolution_notes?.trim() || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </div>
  );
}
