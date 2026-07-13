"use client";

import { useMemo, useState } from "react";
import EmployeePhotoAvatar from "../employee-photo-avatar";
import {
  getStripedRowClassName,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  getDepartmentName,
  getPositionName,
  type PositionLookup,
} from "../employees/lookup-utils";
import { compareStaffIds } from "../employees/employee-record-utils";
import type { StaffIdCardEmployee } from "./staff-id-cards-utils";

function isActiveStaffIdCardEmployee(employee: StaffIdCardEmployee): boolean {
  const status = employee.employment_status?.trim().toLowerCase();

  if (!status) {
    return true;
  }

  return status === "active";
}

type StaffIdCardsProps = {
  initialEmployees: StaffIdCardEmployee[];
  positions: PositionLookup[];
  departmentNameMap: Map<string, string>;
  fetchError: string | null;
};

function StaffIdCard({
  employee,
  departmentName,
  positionName,
}: {
  employee: StaffIdCardEmployee;
  departmentName: string;
  positionName: string;
}) {
  return (
    <article className="id-card-sheet overflow-hidden rounded-md border-2 border-slate-300 bg-white shadow-sm">
      <div className="flex h-full flex-col p-2.5">
        <div className="mb-1.5 flex items-center gap-2 border-b border-[#0f2744]/20 pb-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="Davors Facilities logo"
            className="h-7 w-7 shrink-0 rounded-sm object-cover"
          />
          <p className="text-[7px] font-bold leading-tight text-[#0f2744]">
            Davors Facilities Management Services Ltd
          </p>
        </div>

        <div className="flex min-h-0 flex-1 gap-2">
          <EmployeePhotoAvatar
            photoUrl={employee.photo_url}
            fullName={employee.full_name}
            size="md"
            square
            className="!h-[0.95in] !w-[0.75in] rounded-sm"
          />

          <div className="min-w-0 flex-1 text-[8px] leading-tight text-slate-800">
            <p className="truncate text-[9px] font-bold text-[#0f2744]">
              {employee.full_name}
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-500">Staff ID: </span>
              {employee.staff_id}
            </p>
            <p className="truncate">
              <span className="font-semibold text-slate-500">Position: </span>
              {positionName}
            </p>
            <p className="truncate">
              <span className="font-semibold text-slate-500">Department: </span>
              {departmentName}
            </p>
          </div>
        </div>

        <div className="mt-auto border-t border-dashed border-slate-300 pt-1 text-center">
          <p className="font-mono text-[10px] font-bold tracking-[0.2em] text-[#0f2744]">
            {employee.staff_id}
          </p>
        </div>
      </div>
    </article>
  );
}

export default function StaffIdCards({
  initialEmployees,
  positions,
  departmentNameMap,
  fetchError,
}: StaffIdCardsProps) {
  const activeEmployees = useMemo(
    () =>
      initialEmployees
        .filter((employee) => isActiveStaffIdCardEmployee(employee))
        .sort((left, right) => compareStaffIds(left.staff_id, right.staff_id)),
    [initialEmployees],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showPrintLayout, setShowPrintLayout] = useState(false);

  const allSelected =
    activeEmployees.length > 0 &&
    activeEmployees.every((employee) => selectedIds.has(employee.employee_id));

  const selectedEmployees = useMemo(
    () =>
      activeEmployees.filter((employee) =>
        selectedIds.has(employee.employee_id),
      ),
    [activeEmployees, selectedIds],
  );

  function toggleEmployee(employeeId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) {
        next.delete(employeeId);
      } else {
        next.add(employeeId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds(
      new Set(activeEmployees.map((employee) => employee.employee_id)),
    );
  }

  function handlePrintSelected() {
    if (selectedEmployees.length === 0) {
      return;
    }

    setShowPrintLayout(true);
    window.setTimeout(() => window.print(), 150);
  }

  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load employees: {fetchError}
      </div>
    );
  }

  return (
    <>
      <style>{`
        .id-card-sheet {
          width: 3.375in;
          height: 2.125in;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        @media print {
          body * {
            visibility: hidden;
          }

          #staff-id-cards-print-area,
          #staff-id-cards-print-area * {
            visibility: visible;
          }

          #staff-id-cards-print-area {
            position: absolute;
            inset: 0;
            width: 100%;
            padding: 0.35in;
            background: white;
          }

          .no-print {
            display: none !important;
          }

          .id-card-grid {
            display: grid;
            grid-template-columns: repeat(2, 3.375in);
            gap: 0.2in 0.35in;
            justify-content: center;
          }
        }
      `}</style>

      <div className="no-print space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            Select active employees to print standard staff ID cards (3.375&quot;
            × 2.125&quot;).
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handlePrintSelected}
              disabled={selectedEmployees.length === 0}
              className="rounded-md bg-[#0f2744] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Print Selected ({selectedEmployees.length})
            </button>
            {showPrintLayout ? (
              <button
                type="button"
                onClick={() => setShowPrintLayout(false)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Close Preview
              </button>
            ) : null}
          </div>
        </div>

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all active employees"
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </th>
                <th className={scrollableTableThClassName}>Photo</th>
                <th className={scrollableTableThClassName}>Staff ID</th>
                <th className={scrollableTableThClassName}>Full Name</th>
                <th className={scrollableTableThClassName}>Department</th>
                <th className={scrollableTableThClassName}>Position</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {activeEmployees.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No active employees found.
                  </td>
                </tr>
              ) : (
                activeEmployees.map((employee, index) => {
                  const selected = selectedIds.has(employee.employee_id);

                  return (
                    <tr
                      key={employee.employee_id}
                      className={`${getStripedRowClassName(index)} ${
                        selected ? "bg-slate-100" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleEmployee(employee.employee_id)}
                          aria-label={`Select ${employee.full_name}`}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <EmployeePhotoAvatar
                          photoUrl={employee.photo_url}
                          fullName={employee.full_name}
                          size="sm"
                        />
                      </td>
                      <td className="px-4 py-3">{employee.staff_id}</td>
                      <td className="px-4 py-3">{employee.full_name}</td>
                      <td className="px-4 py-3">
                        {getDepartmentName(
                          departmentNameMap,
                          employee.department,
                          employee.department_ref,
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {getPositionName(positions, employee.position)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollableTable>

        {showPrintLayout && selectedEmployees.length > 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Print preview is ready below. Use your browser&apos;s print dialog
            to print or save as PDF.
          </div>
        ) : null}
      </div>

      {showPrintLayout && selectedEmployees.length > 0 ? (
        <div id="staff-id-cards-print-area" className="mt-6">
          <div className="id-card-grid grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-2">
            {selectedEmployees.map((employee) => (
              <StaffIdCard
                key={employee.employee_id}
                employee={employee}
                departmentName={getDepartmentName(
                  departmentNameMap,
                  employee.department,
                  employee.department_ref,
                )}
                positionName={getPositionName(positions, employee.position)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
