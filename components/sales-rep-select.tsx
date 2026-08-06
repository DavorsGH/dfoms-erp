import { useEffect, useMemo } from "react";
import type { HrEmployee } from "@/app/dashboard/hr-payroll/employee-utils";

type SalesRepSelectProps = {
  id?: string;
  label?: string;
  employees: HrEmployee[];
  value: string;
  onChange: (employeeId: string) => void;
  required?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  hint?: string;
};

export default function SalesRepSelect({
  id = "sales-rep",
  label = "Sales Rep",
  employees,
  value,
  onChange,
  required = false,
  allowEmpty = true,
  emptyLabel = "Unassigned",
  className,
  hint,
}: SalesRepSelectProps) {
  const optionIds = useMemo(
    () => new Set(employees.map((employee) => employee.employee_id)),
    [employees],
  );

  const resolvedValue = useMemo(() => {
    if (value && optionIds.has(value)) {
      return value;
    }
    if (allowEmpty) {
      return "";
    }
    return employees[0]?.employee_id ?? "";
  }, [allowEmpty, employees, optionIds, value]);

  useEffect(() => {
    if (resolvedValue !== value) {
      onChange(resolvedValue);
    }
  }, [onChange, resolvedValue, value]);

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required ? " *" : ""}
      </label>
      <select
        id={id}
        value={resolvedValue}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className={
          className ??
          "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]"
        }
      >
        {allowEmpty ? <option value="">{emptyLabel}</option> : null}
        {employees.map((employee) => (
          <option key={employee.employee_id} value={employee.employee_id}>
            {employee.staff_id} — {employee.full_name}
          </option>
        ))}
      </select>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
