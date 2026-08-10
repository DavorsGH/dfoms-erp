"use client";

import {
  isColumnFilterActive,
  type RegisterColumnFilterValue,
} from "./finance/register-column-filter";

type FilteredListCountLabelOptions = {
  filteredCount: number;
  totalCount: number;
  itemSingular: string;
  itemPlural?: string;
  hasActiveFilters?: boolean;
};

export function formatFilteredListCountLabel({
  filteredCount,
  totalCount,
  itemSingular,
  itemPlural,
  hasActiveFilters = false,
}: FilteredListCountLabelOptions): string {
  const plural = itemPlural ?? `${itemSingular}s`;
  const filteredNoun = filteredCount === 1 ? itemSingular : plural;
  const totalNoun = totalCount === 1 ? itemSingular : plural;

  if (hasActiveFilters && filteredCount !== totalCount) {
    return `${filteredCount} of ${totalCount} ${totalNoun}`;
  }

  return `${filteredCount} ${filteredNoun}`;
}

export type FilteredListCountProps = FilteredListCountLabelOptions & {
  className?: string;
};

/**
 * Prominent filtered/total row count for list and register pages.
 * Place above the table (below search/filter controls).
 */
export default function FilteredListCount({
  filteredCount,
  totalCount,
  itemSingular,
  itemPlural,
  hasActiveFilters = false,
  className = "",
}: FilteredListCountProps) {
  const label = formatFilteredListCountLabel({
    filteredCount,
    totalCount,
    itemSingular,
    itemPlural,
    hasActiveFilters,
  });
  const isNarrowed = hasActiveFilters && filteredCount !== totalCount;

  return (
    <p
      className={`inline-flex items-center rounded-md border-2 px-4 py-1.5 text-base font-bold tabular-nums tracking-tight shadow-sm ${className} ${
        isNarrowed
          ? "border-[#0f2744]/25 bg-[#0f2744] text-white"
          : "border-slate-200 bg-white text-[#0f2744]"
      }`}
      role="status"
      aria-live="polite"
    >
      {label}
    </p>
  );
}

export function anyRegisterColumnFiltersActive(
  ...filters: RegisterColumnFilterValue[]
): boolean {
  return filters.some(isColumnFilterActive);
}
