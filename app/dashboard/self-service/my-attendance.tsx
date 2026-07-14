"use client";

import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { formatDate } from "../hr-payroll/hr-register-utils";
import type { AttendanceRegisterEntry } from "../hr-payroll/attendance-register-utils";

type MyAttendanceProps = {
  initialEntries: AttendanceRegisterEntry[];
  fetchError: string | null;
};

export default function MyAttendance({
  initialEntries,
  fetchError,
}: MyAttendanceProps) {
  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load attendance: {fetchError}
      </div>
    );
  }

  if (initialEntries.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
        No attendance records found for your account.
      </div>
    );
  }

  return (
    <ScrollableTable>
      <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>Date</th>
            <th className={scrollableTableThClassName}>Status</th>
            <th className={scrollableTableThClassName}>Clock In</th>
            <th className={scrollableTableThClassName}>Clock Out</th>
            <th className={scrollableTableThClassName}>Hours</th>
            <th className={scrollableTableThClassName}>Overtime</th>
            <th className={scrollableTableThClassName}>Project</th>
          </tr>
        </thead>
        <tbody>
          {initialEntries.map((entry) => (
            <tr key={entry.id} className="border-b border-slate-100">
              <td className="px-4 py-3 text-sm text-slate-900">
                {formatDate(entry.date)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {entry.attendance_status}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {entry.clock_in ?? "—"}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {entry.clock_out ?? "—"}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {entry.hours_worked ?? "—"}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {entry.overtime_hours ?? "—"}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {entry.project_assignment ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  );
}
