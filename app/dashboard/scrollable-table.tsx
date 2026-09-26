"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

/** Below this scroll-host width, only column 2 stays sticky (column 1 scrolls). */
export const SCROLLABLE_TABLE_SINGLE_STICKY_EDGE_MAX_WIDTH = 640;

type ScrollableTableProps = {
  children: ReactNode;
  /**
   * Pin columns 1–2 when the scroll host is wide enough; only column 2 when the
   * host is narrow (ResizeObserver — see `.scrollable-table-host--single-sticky-edge`
   * in globals.css). Prefer Date col 1 + Name col 2. Last/Actions never pinned.
   */
  stickyEdgeColumns?: boolean;
};

/** Marks cells that should wrap instead of single-line truncation. */
export const scrollableTableWrapCellClassName = "scrollable-table-cell--wrap";

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
  `${scrollableTableThClassName} whitespace-normal ${scrollableTableWrapCellClassName}`;

export const scrollableTableWrapTdClassName =
  `max-w-md px-4 py-3 whitespace-normal break-words align-top ${scrollableTableWrapCellClassName}`;

/** Width hint for column-2 name cells (globals.css caps sticky edge columns). */
export const scrollableTableStickyFirstColumnWidthClassName =
  "min-w-0 max-w-[10rem]";

/** Second-column header (name/label). Sticky position comes from globals.css edge rules. */
export const scrollableTableStickyFirstThClassName =
  `${scrollableTableThClassName} ${scrollableTableStickyFirstColumnWidthClassName}`;

/** Second-column header when the column wraps long text. */
export const scrollableTableStickyFirstWrapThClassName =
  `${scrollableTableWrapThClassName} ${scrollableTableStickyFirstColumnWidthClassName}`;

type ScrollableTableStickyFirstCellOptions = {
  /** Match alternating row shading (odd index = slate-50). */
  striped?: boolean;
};

function scrollableTableStickyFirstCellBackground(
  options?: ScrollableTableStickyFirstCellOptions,
): string {
  return options?.striped ? "bg-slate-50" : "bg-white";
}

/** Second-column body cell for name/label text (truncated via sticky-edge CSS). */
export function scrollableTableStickyFirstWrapTdClassName(
  options?: ScrollableTableStickyFirstCellOptions,
): string {
  return [
    "px-4 py-3 truncate align-top",
    scrollableTableStickyFirstColumnWidthClassName,
    scrollableTableStickyFirstCellBackground(options),
  ].join(" ");
}

/** Second-column body cell for single-line name/label text. */
export function scrollableTableStickyFirstTdClassName(
  options?: ScrollableTableStickyFirstCellOptions,
): string {
  return [
    "px-4 py-3 truncate align-top",
    scrollableTableStickyFirstColumnWidthClassName,
    scrollableTableStickyFirstCellBackground(options),
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

function syncScrollableTableOverflowTitles(host: HTMLElement) {
  host
    .querySelectorAll<HTMLElement>("table tbody td:not([colspan]), table thead th")
    .forEach((cell) => {
      if (cell.classList.contains(scrollableTableWrapCellClassName)) {
        cell.removeAttribute("title");
        return;
      }

      if (
        cell.matches(":last-child") &&
        cell.querySelector("button, a[role='button']")
      ) {
        cell.removeAttribute("title");
        return;
      }

      if (cell.scrollWidth > cell.clientWidth + 1) {
        const text = cell.textContent?.replace(/\s+/g, " ").trim();
        if (text && text !== "—") {
          cell.title = text;
          return;
        }
      }

      cell.removeAttribute("title");
    });
}

function useScrollableTableOverflowTitles(
  hostRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const host = hostRef.current;
    if (!host) return;

    const sync = () => syncScrollableTableOverflowTitles(host);

    sync();

    const mutationObserver = new MutationObserver(sync);
    mutationObserver.observe(host, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(host);
    host.querySelectorAll("table").forEach((table) => resizeObserver.observe(table));

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [enabled, hostRef]);
}

type HorizontalScrollAffordance = {
  canScrollRight: boolean;
  showSwipeHint: boolean;
};

function useHorizontalScrollAffordance(
  hostRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): HorizontalScrollAffordance {
  const [affordance, setAffordance] = useState<HorizontalScrollAffordance>({
    canScrollRight: false,
    showSwipeHint: false,
  });
  const swipeHintDismissedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const host = hostRef.current;
    if (!host) return;

    const update = () => {
      const maxScroll = Math.max(0, host.scrollWidth - host.clientWidth);
      const sl = host.scrollLeft;
      const canScroll = maxScroll > 4;
      if (sl > 8) {
        swipeHintDismissedRef.current = true;
      }
      setAffordance({
        canScrollRight: canScroll && sl < maxScroll - 4,
        showSwipeHint:
          canScroll && sl < 4 && !swipeHintDismissedRef.current,
      });
    };

    update();

    const hintTimer = window.setTimeout(() => {
      swipeHintDismissedRef.current = true;
      update();
    }, 7000);

    host.addEventListener("scroll", update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(host);
    host.querySelectorAll("table").forEach((table) => resizeObserver.observe(table));

    return () => {
      window.clearTimeout(hintTimer);
      host.removeEventListener("scroll", update);
      resizeObserver.disconnect();
    };
  }, [enabled, hostRef]);

  return affordance;
}

function useScrollableTableSingleStickyEdge(
  hostRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): boolean {
  const [singleStickyEdge, setSingleStickyEdge] = useState(false);

  useLayoutEffect(() => {
    if (!enabled) {
      setSingleStickyEdge(false);
      return;
    }
    const host = hostRef.current;
    if (!host) return;

    const update = () => {
      setSingleStickyEdge(
        host.clientWidth < SCROLLABLE_TABLE_SINGLE_STICKY_EDGE_MAX_WIDTH,
      );
    };

    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(host);

    return () => resizeObserver.disconnect();
  }, [enabled, hostRef]);

  return singleStickyEdge;
}

/** Viewport-bounded scroll box with sticky column headers and optional edge columns. */
export default function ScrollableTable({
  children,
  stickyEdgeColumns = true,
}: ScrollableTableProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  useScrollableTableOverflowTitles(hostRef, true);
  const scrollAffordance = useHorizontalScrollAffordance(hostRef, stickyEdgeColumns);
  const singleStickyEdge = useScrollableTableSingleStickyEdge(
    hostRef,
    stickyEdgeColumns,
  );

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="relative min-w-0">
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 right-0 z-[3] w-10 bg-gradient-to-l from-slate-300/50 via-white/95 to-transparent shadow-[-6px_0_12px_-8px_rgba(15,39,68,0.35)] transition-opacity duration-200 ${
            scrollAffordance.canScrollRight ? "opacity-100" : "opacity-0"
          } ${singleStickyEdge ? "" : "md:opacity-0 md:pointer-events-none"}`}
        />
        {scrollAffordance.showSwipeHint ? (
          <p
            aria-hidden
            className={`pointer-events-none absolute bottom-2 left-1/2 z-[3] -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[10px] font-medium text-slate-600 shadow-sm ${
              singleStickyEdge ? "" : "md:hidden"
            }`}
          >
            Swipe for more columns →
          </p>
        ) : null}
        <div
          ref={hostRef}
          className={[
            "min-w-0 w-full max-h-[min(calc(100dvh-8rem),calc(100vh-300px))] overflow-x-auto overflow-y-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] scrollable-table-host",
            stickyEdgeColumns ? "scrollable-table-host--sticky-edges" : "",
            stickyEdgeColumns && singleStickyEdge
              ? "scrollable-table-host--single-sticky-edge"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
