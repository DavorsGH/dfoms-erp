"use client";

import {
  RegisterColumnFilterHeader,
  registerColumnSortConfig,
  type RegisterColumnFilterValue,
  type RegisterColumnSortState,
  type RegisterColumnSortValueType,
} from "../finance/register-column-filter";
import { inputClassName } from "../employees/employee-record-utils";
import type { PayrollTableFilters } from "./payroll-table-filters";

type FilterOptions = {
  contract: string[];
  site: string[];
  position: string[];
  employmentType: string[];
  shift: string[];
};

type PayrollTableFilterBarProps = {
  filters: PayrollTableFilters;
  onChange: (next: PayrollTableFilters) => void;
  options: FilterOptions;
  /** Processing only — History omits this chip. */
  showMissingBasicChip?: boolean;
};

const chipClass = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
    active
      ? "border-[#0f2744] bg-[#0f2744] text-white"
      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
  }`;

export default function PayrollTableFilterBar({
  filters,
  onChange,
  options,
  showMissingBasicChip = false,
}: PayrollTableFilterBarProps) {
  function patch(partial: Partial<PayrollTableFilters>) {
    onChange({ ...filters, ...partial });
  }

  function patchChip(key: keyof PayrollTableFilters["chips"], value: boolean) {
    onChange({
      ...filters,
      chips: { ...filters.chips, [key]: value },
    });
  }

  return (
    <div className="no-print space-y-3">
      <div className="min-w-[220px] max-w-md">
        <label
          htmlFor="payroll-table-search"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Search
        </label>
        <input
          id="payroll-table-search"
          type="search"
          value={filters.search}
          onChange={(event) => patch({ search: event.target.value })}
          placeholder="Employee name or staff ID"
          className={inputClassName}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={chipClass(filters.chips.hasAbsence)}
          aria-pressed={filters.chips.hasAbsence}
          onClick={() =>
            patchChip("hasAbsence", !filters.chips.hasAbsence)
          }
        >
          Has absence deduction
        </button>
        <button
          type="button"
          className={chipClass(filters.chips.hasOvertime)}
          aria-pressed={filters.chips.hasOvertime}
          onClick={() =>
            patchChip("hasOvertime", !filters.chips.hasOvertime)
          }
        >
          Has overtime
        </button>
        {showMissingBasicChip ? (
          <button
            type="button"
            className={chipClass(filters.chips.missingBasic)}
            aria-pressed={filters.chips.missingBasic}
            onClick={() =>
              patchChip("missingBasic", !filters.chips.missingBasic)
            }
          >
            Missing basic salary
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Filters:</span>
        <PayrollInlineFilter
          label="Contract"
          options={options.contract}
          applied={filters.contract}
          onApply={(next) => patch({ contract: next })}
        />
        <PayrollInlineFilter
          label="Site"
          options={options.site}
          applied={filters.site}
          onApply={(next) => patch({ site: next })}
        />
        <PayrollInlineFilter
          label="Position"
          options={options.position}
          applied={filters.position}
          onApply={(next) => patch({ position: next })}
        />
        <PayrollInlineFilter
          label="Employment Type"
          options={options.employmentType}
          applied={filters.employmentType}
          onApply={(next) => patch({ employmentType: next })}
        />
        <PayrollInlineFilter
          label="Shift"
          options={options.shift}
          applied={filters.shift}
          onApply={(next) => patch({ shift: next })}
        />
      </div>
    </div>
  );
}

function PayrollInlineFilter({
  label,
  options,
  applied,
  onApply,
}: {
  label: string;
  options: string[];
  applied: RegisterColumnFilterValue;
  onApply: (next: RegisterColumnFilterValue) => void;
}) {
  return (
    <div className="rounded-md bg-[#0f2744] px-2.5 py-1.5 text-sm text-white">
      <RegisterColumnFilterHeader
        label={label}
        options={options}
        applied={applied}
        onApply={onApply}
      />
    </div>
  );
}

/** White-on-navy sortable header for payroll tables. */
export function PayrollSortableHeader({
  label,
  columnId,
  valueType,
  sort,
  onSortChange,
}: {
  label: string;
  columnId: string;
  valueType: RegisterColumnSortValueType;
  sort: RegisterColumnSortState | null;
  onSortChange: (next: RegisterColumnSortState) => void;
}) {
  const active = sort?.columnId === columnId;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium text-white"
      onClick={() =>
        onSortChange({
          columnId,
          valueType,
          direction: active && sort?.direction === "desc" ? "asc" : "desc",
        })
      }
    >
      {label}
      {active ? (
        <span className="text-[10px] leading-none text-white/90" aria-hidden>
          {sort?.direction === "asc" ? "▲" : "▼"}
        </span>
      ) : null}
    </button>
  );
}

export function payrollColumnSortConfig(
  columnId: string,
  valueType: RegisterColumnSortValueType,
  sort: RegisterColumnSortState | null,
  onSortChange: (next: RegisterColumnSortState) => void,
) {
  return registerColumnSortConfig(columnId, valueType, sort, onSortChange);
}

export function PayrollFilteredTotalsCard({
  filteredCount,
  children,
}: {
  filteredCount: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sky-950">
        Filtered totals ({filteredCount}{" "}
        {filteredCount === 1 ? "employee" : "employees"})
      </h3>
      {children}
    </div>
  );
}
