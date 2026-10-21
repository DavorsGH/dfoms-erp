"use client";

import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  keepEveryoneNextSites,
  listRotatableSiteCodes,
  previewPlannedHeadcount,
  rotateAllNextSites,
  type RotationPlanEmployee,
  type RotationPlanSite,
} from "./rotation-plan";

export default function RotationPlanPanel({
  employees,
  sites,
  nextSiteByEmployee,
  onChange,
}: {
  employees: RotationPlanEmployee[];
  sites: RotationPlanSite[];
  nextSiteByEmployee: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const preview = previewPlannedHeadcount(employees, nextSiteByEmployee, sites);
  const siteName = new Map(sites.map((site) => [site.siteCode, site.siteName]));

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[#0f2744]">
            Plan next rotation
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Choose each person’s next site. Nothing is saved until you start the
            rotation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange(keepEveryoneNextSites(employees))}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Keep everyone where they are
          </button>
          <button
            type="button"
            onClick={() =>
              onChange(
                rotateAllNextSites(employees, listRotatableSiteCodes(sites)),
              )
            }
            className="rounded-md border border-[#0f2744] px-3 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
          >
            Rotate all
          </button>
        </div>
      </div>

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Staff ID</th>
              <th className={scrollableTableThClassName}>Name</th>
              <th className={scrollableTableThClassName}>Current site</th>
              <th className={scrollableTableThClassName}>Next site</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {employees.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                  No staff are on this contract’s sites yet.
                </td>
              </tr>
            ) : (
              employees.map((employee) => (
                <tr key={employee.employeeId}>
                  <td className="px-4 py-3 text-sm">{employee.staffId}</td>
                  <td className="px-4 py-3 text-sm">{employee.fullName}</td>
                  <td className="px-4 py-3 text-sm">
                    {employee.currentSiteCode
                      ? (siteName.get(employee.currentSiteCode) ??
                        employee.currentSiteCode)
                      : "Unassigned"}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={nextSiteByEmployee[employee.employeeId] ?? ""}
                      onChange={(event) =>
                        onChange({
                          ...nextSiteByEmployee,
                          [employee.employeeId]: event.target.value,
                        })
                      }
                      className={inputClassName}
                    >
                      <option value="">Select site</option>
                      {sites.map((site) => (
                        <option key={site.siteCode} value={site.siteCode}>
                          {site.siteName}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-[#0f2744]">
          Planned headcount
        </h4>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Facility</th>
                <th className={scrollableTableThClassName}>Required</th>
                <th className={scrollableTableThClassName}>Planned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {preview.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">
                    This contract has no staffed sites.
                  </td>
                </tr>
              ) : (
                preview.map((row) => (
                  <tr
                    key={row.siteCode}
                    className={row.isUnderStaffed ? "bg-amber-50" : undefined}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {row.siteName}
                        {row.isUnderStaffed ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                            Short staffed
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{row.requiredStaff}</td>
                    <td
                      className={`px-4 py-3 text-sm ${
                        row.isUnderStaffed
                          ? "font-medium text-amber-900"
                          : "text-slate-700"
                      }`}
                    >
                      {row.plannedStaff}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </div>
    </section>
  );
}
