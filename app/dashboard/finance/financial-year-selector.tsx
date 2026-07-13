"use client";

const selectClassName =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

type FinancialYearSelectorProps = {
  years: number[];
  selectedYear: number;
  onChange: (year: number) => void;
};

export default function FinancialYearSelector({
  years,
  selectedYear,
  onChange,
}: FinancialYearSelectorProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label
        htmlFor="financial-year"
        className="text-sm font-medium text-slate-700"
      >
        Financial Year
      </label>
      <select
        id="financial-year"
        value={String(selectedYear)}
        onChange={(event) => onChange(Number(event.target.value))}
        className={selectClassName}
      >
        {years.map((year) => (
          <option key={year} value={String(year)}>
            {year}
          </option>
        ))}
      </select>
    </div>
  );
}
