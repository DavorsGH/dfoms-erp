"use client";

import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

export type MyRosterAssignment = {
  staffId: string;
  fullName: string;
  shift: string | null;
  contractProjectLabel: string;
  assignedSiteLabel: string;
  cycleLabel: string | null;
};

export type MyRosterHistoryRow = {
  effectiveDate: string;
  rosterNumber: string;
  shift: string | null;
  locationLabel: string;
  preparedBy: string | null;
};

type MyRosterProps = {
  assignment: MyRosterAssignment | null;
  history: MyRosterHistoryRow[];
  fetchError: string | null;
};

export default function MyRoster({
  assignment,
  history,
  fetchError,
}: MyRosterProps) {
  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load roster data: {fetchError}
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        No roster assignment found for your employee record.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[#0f2744]">Current Assignment</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-slate-600">Employee</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {assignment.staffId} — {assignment.fullName}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-600">Contract / Site</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {assignment.contractProjectLabel}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-600">Assigned Site</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {assignment.assignedSiteLabel}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-600">Shift Pattern</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {assignment.shift?.trim() || "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm font-medium text-slate-600">Rotation Cycle</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {assignment.cycleLabel ?? "—"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[#0f2744]">Assignment History</h2>
        <p className="mt-1 text-sm text-slate-600">
          Read-only record of your roster rotations and site assignments.
        </p>

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Effective Date</th>
                <th className={scrollableTableThClassName}>Roster No.</th>
                <th className={scrollableTableThClassName}>Location</th>
                <th className={scrollableTableThClassName}>Shift</th>
                <th className={scrollableTableThClassName}>Prepared By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {history.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No roster history recorded yet.
                  </td>
                </tr>
              ) : (
                history.map((row) => (
                  <tr key={`${row.effectiveDate}-${row.rosterNumber}`} className="text-slate-700">
                    <td className="px-4 py-3">{row.effectiveDate}</td>
                    <td className="px-4 py-3">{row.rosterNumber}</td>
                    <td className="px-4 py-3">{row.locationLabel}</td>
                    <td className="px-4 py-3">{row.shift?.trim() || "—"}</td>
                    <td className="px-4 py-3">{row.preparedBy?.trim() || "—"}</td>
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
