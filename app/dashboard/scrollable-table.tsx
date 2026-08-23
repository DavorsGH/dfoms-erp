import type { ReactNode } from "react";

type ScrollableTableProps = {
  children: ReactNode;
};

/**
 * Shared responsive table container for wide register/list screens.
 *
 * Phase 2 pattern (apply via this component in Phase 3):
 * - Desktop/tablet: unchanged table layout with vertical scroll when tall.
 * - Mobile (< md / 768px): horizontal scroll within this container only,
 *   with edge fade cues indicating more columns are available.
 *
 * Do not add page-level horizontal overflow — only scroll inside this box.
 */
export const scrollableTableClassName =
  "min-w-full text-left text-sm whitespace-nowrap";

export const scrollableTableHeadClassName = "bg-[#0f2744] text-white";

export const scrollableTableThClassName =
  "sticky top-0 z-10 bg-[#0f2744] px-4 py-3 font-medium text-white";

/** Use on description / notes / other long free-text columns in scrollable tables. */
export const scrollableTableWrapThClassName =
  `${scrollableTableThClassName} whitespace-normal`;

export const scrollableTableWrapTdClassName =
  "max-w-md px-4 py-3 whitespace-normal break-words align-top";

/** Wider first column for register tables (2–3 lines of name text). */
export const scrollableTableStickyFirstColumnWidthClassName =
  "min-w-[13rem] max-w-[15rem]";

const scrollableTableStickyFirstColumnShadowClassName =
  "shadow-[2px_0_4px_-2px_rgba(15,39,68,0.12)]";

/** Sticky first header — use on the leftmost identifying column (Expense Name, Vendor Name, etc.). */
export const scrollableTableStickyFirstThClassName =
  `${scrollableTableThClassName} sticky left-0 top-0 z-20 ${scrollableTableStickyFirstColumnWidthClassName} ${scrollableTableStickyFirstColumnShadowClassName}`;

/** Sticky first header when the column wraps long text. */
export const scrollableTableStickyFirstWrapThClassName =
  `${scrollableTableWrapThClassName} sticky left-0 top-0 z-20 ${scrollableTableStickyFirstColumnWidthClassName} ${scrollableTableStickyFirstColumnShadowClassName}`;

type ScrollableTableStickyFirstCellOptions = {
  /** Match alternating row shading (odd index = slate-50). */
  striped?: boolean;
};

function scrollableTableStickyFirstCellBackground(
  options?: ScrollableTableStickyFirstCellOptions,
): string {
  return options?.striped ? "bg-slate-50" : "bg-white";
}

/** Sticky first body cell for wrapped identifying text. */
export function scrollableTableStickyFirstWrapTdClassName(
  options?: ScrollableTableStickyFirstCellOptions,
): string {
  return [
    "px-4 py-3 whitespace-normal break-words align-top",
    "sticky left-0 z-[5]",
    scrollableTableStickyFirstColumnWidthClassName,
    scrollableTableStickyFirstCellBackground(options),
    scrollableTableStickyFirstColumnShadowClassName,
  ].join(" ");
}

/** Sticky first body cell for single-line identifying text. */
export function scrollableTableStickyFirstTdClassName(
  options?: ScrollableTableStickyFirstCellOptions,
): string {
  return [
    "px-4 py-3 whitespace-normal break-words align-top",
    "sticky left-0 z-[5]",
    scrollableTableStickyFirstColumnWidthClassName,
    scrollableTableStickyFirstCellBackground(options),
    scrollableTableStickyFirstColumnShadowClassName,
  ].join(" ");
}

/** Long free-text cells outside scrollable register tables (detail views, forms). */
export const tableWrapCellClassName =
  "max-w-md whitespace-normal break-words align-top";

const LONG_TEXT_TABLE_HEADINGS = new Set([
  "Action Taken",
  "Complaint Details",
  "Description",
  "Details",
  "Issue",
  "Issue Description",
  "Message",
  "Notes",
  "Problem Description",
]);

export function scrollableTableHeadingClassName(heading: string): string {
  return LONG_TEXT_TABLE_HEADINGS.has(heading)
    ? scrollableTableWrapThClassName
    : scrollableTableThClassName;
}

export const scrollableTableBodyClassName = "divide-y divide-slate-200";

/** Viewport-bounded scroll box with sticky column headers. */
export default function ScrollableTable({ children }: ScrollableTableProps) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="relative min-w-0">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-4 bg-gradient-to-r from-white to-transparent md:hidden"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-6 bg-gradient-to-l from-white via-white/80 to-transparent md:hidden"
        />
        <div className="min-w-0 max-h-[calc(100vh-300px)] overflow-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
          {children}
        </div>
      </div>
    </section>
  );
}
