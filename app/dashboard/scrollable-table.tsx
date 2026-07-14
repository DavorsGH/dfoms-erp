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
