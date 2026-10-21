"use client";

import { useEffect, useMemo, useState } from "react";
import { inputClassName } from "../employees/employee-record-utils";
import { listRosterContractChoices } from "@/lib/roster-contract-choices";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";
import {
  buildClientAssignmentProjectCodes,
  filterHistoryForClient,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type DutyRosterSite,
  type RosterHistoryRecord,
} from "./duty-roster-utils";
import { useRosterContractSelection } from "./use-roster-contract-selection";

type RosterHistoryProps = {
  initialHistory: RosterHistoryRecord[];
  employees: DutyRosterEmployee[];
  projects: DutyRosterProject[];
  sites: DutyRosterSite[];
  fetchError: string | null;
};

export default function RosterHistory({
  initialHistory,
  employees,
  projects,
  sites,
  fetchError,
}: RosterHistoryProps) {
  const [rotationFilter, setRotationFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");

  const employeeNameById = useMemo(() => {
    return new Map(
      employees.map((employee) => [employee.employee_id, employee.full_name]),
    );
  }, [employees]);

  const contractChoices = useMemo(
    () =>
      listRosterContractChoices({
        projects,
        sites: sites.map((site) => ({
          client_id: site.client_id,
          project_code: site.project?.project_code ?? null,
        })),
        employees,
      }),
    [projects, sites, employees],
  );
  const { groupKey, selected, selectContract } =
    useRosterContractSelection(contractChoices);
  const contractHistory = useMemo(() => {
    const clientId = selected?.clientId;
    if (!clientId) {
      return [];
    }
    return filterHistoryForClient(
      initialHistory,
      employees,
      buildClientAssignmentProjectCodes(sites, projects, clientId),
    );
  }, [employees, initialHistory, projects, selected, sites]);

  const visibleEmployees = useMemo(() => {
    const clientId = selected?.clientId;
    if (!clientId) {
      return [];
    }
    const codes = buildClientAssignmentProjectCodes(sites, projects, clientId);
    return employees.filter(
      (employee) =>
        employee.contract_project != null && codes.has(employee.contract_project),
    );
  }, [employees, projects, selected, sites]);

  useEffect(() => {
    setRotationFilter("");
    setEmployeeFilter("");
  }, [groupKey]);

  const rotationOptions = useMemo(() => {
    const values = new Set<number>();
    for (const row of contractHistory) {
      if (row.rotation_number != null) {
        values.add(row.rotation_number);
      }
    }
    return [...values].sort((left, right) => right - left);
  }, [contractHistory]);

  const filteredHistory = useMemo(() => {
    return contractHistory.filter((row) => {
      if (
        rotationFilter &&
        String(row.rotation_number ?? "") !== rotationFilter
      ) {
        return false;
      }

      if (employeeFilter && row.employee_id !== employeeFilter) {
        return false;
      }

      return true;
    });
  }, [contractHistory, employeeFilter, rotationFilter]);

  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {fetchError}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Permanent audit trail of roster assignment changes. Records are
        append-only and cannot be edited or deleted.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Contract
          </label>
          <select
            value={groupKey}
            onChange={(event) => selectContract(event.target.value)}
            className={inputClassName}
          >
            <option value="">Select contract</option>
            {contractChoices.map((choice) => (
              <option key={choice.groupKey} value={choice.groupKey}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Filter by Rotation
          </label>
          <select
            value={rotationFilter}
            onChange={(event) => setRotationFilter(event.target.value)}
            className={inputClassName}
          >
            <option value="">All rotations</option>
            {rotationOptions.map((rotation) => (
              <option key={rotation} value={String(rotation)}>
                Rotation {rotation}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Filter by Employee
          </label>
          <select
            value={employeeFilter}
            onChange={(event) => setEmployeeFilter(event.target.value)}
            className={inputClassName}
          >
            <option value="">All employees</option>
            {visibleEmployees.map((employee) => (
              <option key={employee.employee_id} value={employee.employee_id}>
                {employee.staff_id} — {employee.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected?.dataIssue ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {selected.dataIssue}
        </p>
      ) : null}

      <FilteredListCount
        filteredCount={filteredHistory.length}
        totalCount={contractHistory.length}
        itemSingular="record"
        hasActiveFilters={Boolean(rotationFilter || employeeFilter)}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Roster #</th>
              <th className={scrollableTableThClassName}>Rotation</th>
              <th className={scrollableTableThClassName}>Effective</th>
              <th className={scrollableTableThClassName}>End</th>
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Previous Location</th>
              <th className={scrollableTableThClassName}>New Location</th>
              <th className={scrollableTableThClassName}>Position</th>
              <th className={scrollableTableThClassName}>Shift</th>
              <th className={scrollableTableThClassName}>Generated By</th>
              <th className={scrollableTableThClassName}>Date Generated</th>
            </tr>
          </thead>
          <tbody className={scrollableTableBodyClassName}>
            {filteredHistory.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  {!selected?.clientId
                    ? "Select a contract to see its roster history."
                    : contractHistory.length === 0
                      ? "No roster history records yet for this contract. Records appear here after a Duty Roster rotation is started."
                      : "No roster history records match the selected filters."}
                </td>
              </tr>
            ) : (
              filteredHistory.map((row, index) => (
                <tr key={row.roster_number} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {row.roster_number}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {row.rotation_number ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {row.effective_date}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {row.end_date ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {row.employee_id
                      ? (employeeNameById.get(row.employee_id) ?? row.employee_id)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {row.previous_location ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {row.new_location ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {row.position ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {row.shift ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {row.generated_by ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {row.date_generated ?? "—"}
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
