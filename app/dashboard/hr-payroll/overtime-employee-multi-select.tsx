"use client";

import { useMemo, useState } from "react";
import type { HrEmployee } from "./employee-utils";
import { inputClassName } from "./hr-register-utils";

type OvertimeEmployeeMultiSelectProps = {
  employees: HrEmployee[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  error?: string | null;
};

export default function OvertimeEmployeeMultiSelect({
  employees,
  selectedIds,
  onChange,
  disabled = false,
  error = null,
}: OvertimeEmployeeMultiSelectProps) {
  const [filter, setFilter] = useState("");

  const filteredEmployees = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) {
      return employees;
    }
    return employees.filter((employee) =>
      employee.full_name.toLowerCase().includes(query),
    );
  }, [employees, filter]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggleEmployee(employeeId: string) {
    if (disabled) {
      return;
    }
    const next = new Set(selectedSet);
    if (next.has(employeeId)) {
      next.delete(employeeId);
    } else {
      next.add(employeeId);
    }
    onChange([...next]);
  }

  return (
    <div>
      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Search employees…"
        className={`${inputClassName} mb-2`}
        disabled={disabled}
        aria-label="Search employees"
      />
      <div
        className={`max-h-48 overflow-y-auto rounded-md border border-slate-300 bg-white p-2 ${
          error ? "border-red-400" : ""
        }`}
      >
        {filteredEmployees.length === 0 ? (
          <p className="px-2 py-3 text-sm text-slate-500">No employees match.</p>
        ) : (
          <ul className="space-y-1">
            {filteredEmployees.map((employee) => {
              const checked = selectedSet.has(employee.employee_id);
              return (
                <li key={employee.employee_id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleEmployee(employee.employee_id)}
                      className="rounded border-slate-300"
                    />
                    <span className="text-slate-900">{employee.full_name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {selectedIds.length} selected
      </p>
      {error ? (
        <p className="mt-1 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
