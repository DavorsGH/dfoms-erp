"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatDutyRosterEffectiveLabel,
  type DutyRosterViewModel,
} from "./duty-roster-utils";

type DutyRosterProps = {
  data: DutyRosterViewModel | null;
  fetchError: string | null;
  preparedByDefault: string;
};

function formatTodayLabel(): string {
  return new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatShortDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function DutyRoster({
  data,
  fetchError,
  preparedByDefault,
}: DutyRosterProps) {
  const router = useRouter();
  const [preparedBy, setPreparedBy] = useState(preparedByDefault);
  const [approvedBy, setApprovedBy] = useState("");
  const [rosterDate, setRosterDate] = useState(formatTodayLabel());
  const [startingRotation, setStartingRotation] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const effectiveLabel = useMemo(() => {
    if (!data) {
      return "";
    }

    return formatDutyRosterEffectiveLabel(
      data.summary.cycleStartDate,
      data.summary.cycleEndDate,
    );
  }, [data]);

  async function handleStartRotation() {
    if (!data) {
      return;
    }

    const confirmed = window.confirm(
      `Start Rotation ${data.currentRotationNumber + 1}?\n\nThis will advance the cycle to begin ${formatShortDate(data.summary.nextRotationDate)} and record assignment changes in Roster History.`,
    );

    if (!confirmed) {
      return;
    }

    setStartingRotation(true);
    setActionError(null);
    setActionMessage(null);

    try {
      const response = await fetch("/api/operations/start-rotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        insertedCount?: number;
      };

      if (!response.ok) {
        setActionError(payload.error ?? "Failed to start new rotation.");
        return;
      }

      setActionMessage(
        payload.message ??
          `Rotation started. ${payload.insertedCount ?? 0} change(s) recorded.`,
      );
      router.refresh();
    } catch {
      setActionError("Failed to start new rotation.");
    } finally {
      setStartingRotation(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {fetchError}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { summary, rows, totals } = data;

  return (
    <>
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }

          #duty-roster-print-area,
          #duty-roster-print-area * {
            visibility: visible;
          }

          #duty-roster-print-area {
            display: block;
            position: absolute;
            inset: 0;
            width: 100%;
            padding: 24px;
            background: white;
          }

          .no-print {
            display: none !important;
          }
        }

        #duty-roster-print-area {
          display: none;
        }
      `}</style>

      <div className="no-print space-y-6">
        {actionError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {actionError}
          </p>
        ) : null}
        {actionMessage ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {actionMessage}
          </p>
        ) : null}

        <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Current Rotation
            </p>
            <p className="mt-1 text-sm font-medium text-[#0f2744]">
              {summary.currentRotationLabel}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Next Rotation
            </p>
            <p className="mt-1 text-sm font-medium text-[#0f2744]">
              {formatShortDate(summary.nextRotationDate)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Days to Rotation
            </p>
            <p className="mt-1 text-sm font-medium text-[#0f2744]">
              {summary.daysToRotation} day{summary.daysToRotation === 1 ? "" : "s"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Staff Assigned
            </p>
            <p className="mt-1 text-sm font-medium text-[#0f2744]">
              {summary.staffAssignedCount} of {summary.totalActiveCount} (
              {summary.staffAssignedPercent}%)
            </p>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleStartRotation}
            disabled={startingRotation}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {startingRotation ? "Starting Rotation…" : "Start New Rotation"}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            Print
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Download PDF
          </button>
          <Link
            href="/dashboard/operations/roster-history"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            View Roster History
          </Link>
        </div>

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Facility</th>
                <th className={scrollableTableThClassName}>
                  Morning Shift
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    {summary.morningTime}
                  </span>
                </th>
                <th className={scrollableTableThClassName}>
                  Afternoon Shift
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    {summary.afternoonTime}
                  </span>
                </th>
                <th className={scrollableTableThClassName}>
                  Supervisor(s)
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    {summary.supervisorTime}
                  </span>
                </th>
                <th className={scrollableTableThClassName}>Required Staff</th>
                <th className={scrollableTableThClassName}>Total Staff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No active employees are assigned to a facility yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.projectCode}
                    className={
                      row.isStaffingMismatch ? "bg-red-50" : undefined
                    }
                  >
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      <span className="inline-flex items-center gap-2">
                        {row.isStaffingMismatch ? (
                          <span
                            aria-hidden
                            className="text-red-600"
                            title="Staffing mismatch"
                          >
                            ⚠
                          </span>
                        ) : null}
                        {row.facilityName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.morningShift}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.afternoonShift}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.supervisors}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.requiredStaff}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.totalStaff}
                    </td>
                  </tr>
                ))
              )}
              {rows.length > 0 ? (
                <tr className="bg-slate-100 font-semibold text-[#0f2744]">
                  <td className="px-4 py-3">TOTAL</td>
                  <td className="px-4 py-3" colSpan={3} />
                  <td className="px-4 py-3">{totals.requiredStaff}</td>
                  <td className="px-4 py-3">{totals.totalStaff}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </ScrollableTable>

        <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Prepared By
            </label>
            <input
              type="text"
              value={preparedBy}
              onChange={(event) => setPreparedBy(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Approved By
            </label>
            <input
              type="text"
              value={approvedBy}
              onChange={(event) => setApprovedBy(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Date
            </label>
            <input
              type="text"
              value={rosterDate}
              onChange={(event) => setRosterDate(event.target.value)}
              className={inputClassName}
            />
          </div>
        </section>
      </div>

      <div id="duty-roster-print-area">
        <header className="mb-6 border-b border-slate-300 pb-4 text-center">
          <p className="text-lg font-semibold text-[#0f2744]">
            Davors Facilities Management Services Ltd
          </p>
          <h1 className="mt-2 text-xl font-bold text-[#0f2744]">
            Central University Cleaning Contract - Duty Roster
          </h1>
          <p className="mt-2 text-sm text-slate-700">
            Effective: {effectiveLabel}
          </p>
          <p className="text-sm text-slate-700">{summary.currentRotationLabel}</p>
        </header>

        <table className="mb-6 w-full border-collapse text-xs">
          <thead>
            <tr className="border border-slate-400 bg-slate-100">
              <th className="border border-slate-400 px-2 py-2 text-left">
                Facility
              </th>
              <th className="border border-slate-400 px-2 py-2 text-left">
                Morning Shift
                <div className="font-normal text-slate-600">
                  {summary.morningTime}
                </div>
              </th>
              <th className="border border-slate-400 px-2 py-2 text-left">
                Afternoon Shift
                <div className="font-normal text-slate-600">
                  {summary.afternoonTime}
                </div>
              </th>
              <th className="border border-slate-400 px-2 py-2 text-left">
                Supervisor(s)
                <div className="font-normal text-slate-600">
                  {summary.supervisorTime}
                </div>
              </th>
              <th className="border border-slate-400 px-2 py-2 text-right">
                Required
              </th>
              <th className="border border-slate-400 px-2 py-2 text-right">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.projectCode}>
                <td className="border border-slate-400 px-2 py-2 align-top">
                  {row.facilityName}
                </td>
                <td className="border border-slate-400 px-2 py-2 align-top">
                  {row.morningShift}
                </td>
                <td className="border border-slate-400 px-2 py-2 align-top">
                  {row.afternoonShift}
                </td>
                <td className="border border-slate-400 px-2 py-2 align-top">
                  {row.supervisors}
                </td>
                <td className="border border-slate-400 px-2 py-2 text-right align-top">
                  {row.requiredStaff}
                </td>
                <td className="border border-slate-400 px-2 py-2 text-right align-top">
                  {row.totalStaff}
                </td>
              </tr>
            ))}
            {rows.length > 0 ? (
              <tr className="bg-slate-100 font-semibold">
                <td className="border border-slate-400 px-2 py-2">TOTAL</td>
                <td className="border border-slate-400 px-2 py-2" colSpan={3} />
                <td className="border border-slate-400 px-2 py-2 text-right">
                  {totals.requiredStaff}
                </td>
                <td className="border border-slate-400 px-2 py-2 text-right">
                  {totals.totalStaff}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <footer className="grid grid-cols-3 gap-4 border-t border-slate-300 pt-4 text-sm">
          <div>
            <p className="text-slate-600">Prepared By</p>
            <p className="mt-6 border-b border-slate-400 pb-1 font-medium text-slate-900">
              {preparedBy || " "}
            </p>
          </div>
          <div>
            <p className="text-slate-600">Approved By</p>
            <p className="mt-6 border-b border-slate-400 pb-1 font-medium text-slate-900">
              {approvedBy || " "}
            </p>
          </div>
          <div>
            <p className="text-slate-600">Date</p>
            <p className="mt-6 border-b border-slate-400 pb-1 font-medium text-slate-900">
              {rosterDate || " "}
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}
