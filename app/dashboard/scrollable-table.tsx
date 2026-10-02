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
  /** Wider sticky name (col 2) and category (col 3) — Expense Register, Fixed Assets. */
  stickyEdgeLayout?: "default" | "nameCategory";
};

/** Host modifier for {@link ScrollableTableProps.stickyEdgeLayout}. */
export const scrollableTableHostRegisterNameCategoryClassName =
  "scrollable-table-host--register-name-category";

/** Marks cells that should wrap instead of single-line truncation. */
export const scrollableTableWrapCellClassName = "scrollable-table-cell--wrap";

/** Primary label column — pairs with globals.css identifying rules (wrap / 2-line cap). */
export const scrollableTableIdentifyingCellClassName =
  "scrollable-table-cell--identifying";

/** Dates, amounts, status codes, short enums — stay on one line, shrink to content. */
export const scrollableTableCompactCellClassName =
  "scrollable-table-cell--compact";

/** Actions column — nowrap, width fits button group (see globals.css). */
export const scrollableTableActionsCellClassName =
  "scrollable-table-cell--actions";

export const scrollableTableActionsTdClassName = `px-4 py-3 whitespace-nowrap ${scrollableTableCompactCellClassName} ${scrollableTableActionsCellClassName}`;

/** Opt out of register table body ellipsis (IDs, dates, numeric codes). */
export const scrollableTableNoTruncateCellClassName =
  "scrollable-table-cell--no-truncate";

export const scrollableTableRegisterDateCellClassName =
  `px-4 py-3 whitespace-nowrap tabular-nums ${scrollableTableNoTruncateCellClassName} scrollable-table-register-col-date`;

export const scrollableTableRegisterIdCellClassName =
  `px-4 py-3 whitespace-nowrap tabular-nums ${scrollableTableNoTruncateCellClassName} scrollable-table-register-col-id`;

export const scrollableTableRegisterUsefulLifeCellClassName =
  `px-4 py-3 whitespace-nowrap tabular-nums text-right ${scrollableTableNoTruncateCellClassName} scrollable-table-register-col-useful-life`;

/**
 * Shared responsive table container for wide register/list screens.
 *
 * Phase 2 pattern (apply via this component in Phase 3):
 * - Desktop/tablet: unchanged table layout with vertical scroll when tall.
 * - Mobile (< md / 768px): horizontal scroll within this container only;
 *   optional swipe hint when more columns are off-screen.
 *
 * Do not add page-level horizontal overflow — only scroll inside this box.
 */
export const scrollableTableClassName =
  "min-w-full text-left text-sm whitespace-nowrap";

/** Month / amount columns stay on one line; line item column wraps separately. */
export const scrollableTableFinancialStatementClassName =
  "min-w-full text-left text-sm";

export const scrollableTableHeadClassName = "bg-[#0f2744] text-white";

export const scrollableTableThClassName =
  "sticky top-0 z-10 bg-[#0f2744] px-4 py-3 font-medium text-white";

export const scrollableTableActionsThClassName = `${scrollableTableThClassName} ${scrollableTableCompactCellClassName} ${scrollableTableActionsCellClassName}`;

export const scrollableTableRegisterUsefulLifeThClassName =
  `${scrollableTableThClassName} whitespace-normal ${scrollableTableNoTruncateCellClassName} scrollable-table-register-col-useful-life`;

/** Financial statements — sticky layout is entirely in `.scrollable-table-host--financial-statement`. */
export const scrollableTableFinancialStatementHeadClassName =
  "bg-[#0f2744] text-white";

export const scrollableTableFinancialStatementThClassName =
  "bg-[#0f2744] px-4 py-3 font-medium text-white";

const scrollableTableFinancialStatementLineItemWidthClassName =
  "min-w-[15rem] w-[15rem] max-w-[15rem] shrink-0";

export const scrollableTableFinancialStatementLineItemThClassName =
  `${scrollableTableFinancialStatementThClassName} ${scrollableTableFinancialStatementLineItemWidthClassName} ${scrollableTableWrapCellClassName} whitespace-normal align-top break-normal`;

export const scrollableTableLineItemThClassName =
  `${scrollableTableThClassName} ${scrollableTableWrapCellClassName} whitespace-normal align-top`;

export const scrollableTableLineItemTdClassName =
  `px-4 py-3 align-top whitespace-normal break-words ${scrollableTableWrapCellClassName}`;

export const scrollableTableFinancialStatementLineItemTdClassNameBase =
  `px-4 py-3 align-top whitespace-normal break-words ${scrollableTableFinancialStatementLineItemWidthClassName} ${scrollableTableWrapCellClassName}`;

export type ScrollableTableFinancialStatementLineItemKind =
  | "section"
  | "subtotal"
  | "total"
  | "normal";

export function scrollableTableFinancialStatementLineItemTdClassName(
  rowKind: ScrollableTableFinancialStatementLineItemKind,
): string {
  if (rowKind === "section") {
    return `${scrollableTableFinancialStatementLineItemTdClassNameBase} break-normal uppercase`;
  }
  if (rowKind === "subtotal" || rowKind === "total") {
    return `${scrollableTableFinancialStatementLineItemTdClassNameBase} font-semibold`;
  }
  return scrollableTableFinancialStatementLineItemTdClassNameBase;
}

/**
 * P&L / Balance Sheet / Cash Flow section heading rows (ASSETS, LIABILITIES, …).
 * Hook for `.scrollable-table-host--financial-statement` sticky line-item backgrounds.
 */
export const scrollableTableStatementSectionRowClassName =
  "scrollable-table-row--statement-section bg-[#0f2744] text-sm uppercase tracking-wide text-white";

/** Use on description / notes / other long free-text columns in scrollable tables. */
export const scrollableTableWrapThClassName =
  `${scrollableTableThClassName} whitespace-normal ${scrollableTableWrapCellClassName}`;

export const scrollableTableWrapTdClassName =
  `max-w-md px-4 py-3 whitespace-normal break-words align-top ${scrollableTableWrapCellClassName}`;

export const scrollableTableIdentifyingThClassName =
  `${scrollableTableThClassName} ${scrollableTableIdentifyingCellClassName}`;

export const scrollableTableIdentifyingTdClassName =
  `px-4 py-3 align-middle ${scrollableTableIdentifyingCellClassName}`;

/** Sticky col 2 on finance registers with {@link scrollableTableHostRegisterNameCategoryClassName}. */
export const scrollableTableRegisterStickyNameThClassName =
  `${scrollableTableWrapThClassName} ${scrollableTableIdentifyingCellClassName}`;

export function scrollableTableRegisterStickyNameWrapTdClassName(
  options?: ScrollableTableStickyFirstCellOptions,
): string {
  return [
    scrollableTableIdentifyingTdClassName,
    scrollableTableStickyFirstCellBackground(options),
  ].join(" ");
}

export const scrollableTableRegisterCategoryCellClassName =
  "px-4 py-3 scrollable-table-register-col-category";

export const scrollableTableRegisterCategoryThClassName =
  `${scrollableTableThClassName} scrollable-table-register-col-category`;

/** Second-column header (name/label). Sticky position comes from globals.css edge rules. */
export const scrollableTableStickyFirstThClassName =
  scrollableTableIdentifyingThClassName;

/** Second-column header when the column wraps long text. */
export const scrollableTableStickyFirstWrapThClassName =
  `${scrollableTableWrapThClassName} ${scrollableTableIdentifyingCellClassName}`;

type ScrollableTableStickyFirstCellOptions = {
  /** Match alternating row shading (odd index = slate-50). */
  striped?: boolean;
};

function scrollableTableStickyFirstCellBackground(
  options?: ScrollableTableStickyFirstCellOptions,
): string {
  return options?.striped ? "bg-slate-50" : "bg-white";
}

/** Second-column body cell for name/label text. */
export function scrollableTableStickyFirstWrapTdClassName(
  options?: ScrollableTableStickyFirstCellOptions,
): string {
  return [
    scrollableTableIdentifyingTdClassName,
    scrollableTableStickyFirstCellBackground(options),
  ].join(" ");
}

/** Second-column body cell for single-line name/label text. */
export function scrollableTableStickyFirstTdClassName(
  options?: ScrollableTableStickyFirstCellOptions,
): string {
  return [
    scrollableTableIdentifyingTdClassName,
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

const COMPACT_TABLE_HEADINGS = new Set([
  "Actions",
  "Active",
  "Amount",
  "Basic Salary",
  "Days",
  "Effective Date",
  "Employment Type",
  "Qty",
  "Quantity",
  "Role",
  "Shift",
  "Status",
  "Type",
]);

export function scrollableTableHeadingClassName(heading: string): string {
  if (LONG_TEXT_TABLE_HEADINGS.has(heading)) {
    return scrollableTableWrapThClassName;
  }
  if (COMPACT_TABLE_HEADINGS.has(heading)) {
    return `${scrollableTableThClassName} ${scrollableTableCompactCellClassName}`;
  }
  return scrollableTableThClassName;
}

export function scrollableTableBodyCellClassNameForHeading(
  heading: string,
): string {
  if (LONG_TEXT_TABLE_HEADINGS.has(heading)) {
    return scrollableTableWrapTdClassName;
  }
  if (COMPACT_TABLE_HEADINGS.has(heading)) {
    return `px-4 py-3 ${scrollableTableCompactCellClassName}`;
  }
  return "px-4 py-3";
}

export const scrollableTableBodyClassName = "divide-y divide-slate-200";

function cellContentIsClipped(cell: HTMLElement): boolean {
  return (
    cell.scrollWidth > cell.clientWidth + 1 ||
    cell.scrollHeight > cell.clientHeight + 1
  );
}

function syncScrollableTableOverflowTitles(host: HTMLElement) {
  host
    .querySelectorAll<HTMLElement>("table tbody td:not([colspan]), table thead th")
    .forEach((cell) => {
      if (cell.classList.contains(scrollableTableWrapCellClassName)) {
        cell.removeAttribute("title");
        return;
      }

      if (
        cell.classList.contains("register-truncated-cell-host") ||
        cell.querySelector(".register-truncated-cell")
      ) {
        cell.removeAttribute("title");
        return;
      }

      if (cell.classList.contains(scrollableTableNoTruncateCellClassName)) {
        cell.removeAttribute("title");
        return;
      }

      if (cell.classList.contains(scrollableTableCompactCellClassName)) {
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

      if (cellContentIsClipped(cell)) {
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

function useHorizontalScrollSwipeHint(
  hostRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): boolean {
  const [showSwipeHint, setShowSwipeHint] = useState(false);
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
      setShowSwipeHint(
        canScroll && sl < 4 && !swipeHintDismissedRef.current,
      );
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

  return showSwipeHint;
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

function queryFirstCol1BodyCell(table: Element): HTMLElement | null {
  return table.querySelector(
    "tbody td:nth-child(1):not([colspan])",
  ) as HTMLElement | null;
}

/**
 * Sets `--st-edge-col-1-offset` from measured column 1 width so sticky column 2
 * `left` matches the real column 1 edge (including max-content date/id cells).
 */
function useScrollableTableStickyEdgeColumnOffsets(
  hostRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  singleStickyEdge: boolean,
) {
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    if (!enabled || singleStickyEdge) {
      host.style.removeProperty("--st-edge-col-1-offset");
      return;
    }

    let observedFirstCol1Body: Element | null = null;

    const sync = () => {
      const table = host.querySelector("table");
      const col1Header = table?.querySelector(
        "thead th:nth-child(1)",
      ) as HTMLElement | null;

      if (!col1Header) {
        host.style.removeProperty("--st-edge-col-1-offset");
        return;
      }

      let width = col1Header.getBoundingClientRect().width;
      const firstCol1Body = table ? queryFirstCol1BodyCell(table) : null;
      if (firstCol1Body) {
        width = Math.max(width, firstCol1Body.getBoundingClientRect().width);
      }

      host.style.setProperty("--st-edge-col-1-offset", `${Math.ceil(width)}px`);

      if (table) {
        const nextFirstCol1Body = queryFirstCol1BodyCell(table);
        if (nextFirstCol1Body !== observedFirstCol1Body) {
          if (observedFirstCol1Body) {
            resizeObserver.unobserve(observedFirstCol1Body);
          }
          observedFirstCol1Body = nextFirstCol1Body;
          if (nextFirstCol1Body) {
            resizeObserver.observe(nextFirstCol1Body);
          }
        }
      }
    };

    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(host);
    const table = host.querySelector("table");
    if (table) {
      resizeObserver.observe(table);
      table
        .querySelectorAll("thead th:nth-child(1), thead th:nth-child(2)")
        .forEach((cell) => resizeObserver.observe(cell));
    }

    sync();

    const mutationObserver = new MutationObserver(sync);
    if (table) {
      mutationObserver.observe(table, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      host.style.removeProperty("--st-edge-col-1-offset");
    };
  }, [enabled, singleStickyEdge, hostRef]);
}

function ScrollableTableFrame({
  hostRef,
  hostClassName,
  showSwipeHint,
  swipeHintWideOnly,
  children,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  hostClassName: string;
  showSwipeHint: boolean;
  swipeHintWideOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="relative min-w-0">
        {showSwipeHint ? (
          <p
            aria-hidden
            className={`pointer-events-none absolute bottom-2 left-1/2 z-[3] -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[10px] font-medium text-slate-600 shadow-sm ${
              swipeHintWideOnly ? "" : "md:hidden"
            }`}
          >
            Swipe for more columns →
          </p>
        ) : null}
        <div ref={hostRef} className={hostClassName}>
          {children}
        </div>
      </div>
    </section>
  );
}

const scrollableTableHostBaseClassName =
  "min-w-0 w-full max-h-[min(calc(100dvh-8rem),calc(100vh-300px))] overflow-x-auto overflow-y-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] scrollable-table-host";

/** Viewport-bounded scroll box with sticky column headers and optional edge columns. */
export default function ScrollableTable({
  children,
  stickyEdgeColumns = true,
  stickyEdgeLayout = "default",
}: ScrollableTableProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  useScrollableTableOverflowTitles(hostRef, true);
  const showSwipeHint = useHorizontalScrollSwipeHint(hostRef, stickyEdgeColumns);
  const singleStickyEdge = useScrollableTableSingleStickyEdge(
    hostRef,
    stickyEdgeColumns,
  );
  useScrollableTableStickyEdgeColumnOffsets(
    hostRef,
    stickyEdgeColumns,
    singleStickyEdge,
  );

  return (
    <ScrollableTableFrame
      hostRef={hostRef}
      showSwipeHint={showSwipeHint}
      swipeHintWideOnly={!singleStickyEdge}
      hostClassName={[
        scrollableTableHostBaseClassName,
        stickyEdgeColumns ? "scrollable-table-host--sticky-edges" : "",
        stickyEdgeColumns && singleStickyEdge
          ? "scrollable-table-host--single-sticky-edge"
          : "",
        stickyEdgeColumns && stickyEdgeLayout === "nameCategory"
          ? scrollableTableHostRegisterNameCategoryClassName
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </ScrollableTableFrame>
  );
}

/**
 * Balance Sheet / Cash Flow / P&L / statement reports — not register sticky-edges.
 * See `app/financial-statement-table.css`.
 */
export function FinancialStatementScrollableTable({
  children,
}: {
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useScrollableTableOverflowTitles(hostRef, true);
  const showSwipeHint = useHorizontalScrollSwipeHint(hostRef, true);

  return (
    <ScrollableTableFrame
      hostRef={hostRef}
      showSwipeHint={showSwipeHint}
      hostClassName={`${scrollableTableHostBaseClassName} scrollable-table-host--financial-statement`}
    >
      {children}
    </ScrollableTableFrame>
  );
}
