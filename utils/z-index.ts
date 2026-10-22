/**
 * App-wide stacking scale (keep in sync with `--z-*` in `app/globals.css`).
 *
 * table sticky < page sticky < top bar < dropdowns < popovers < modals < toasts < tooltips
 */
export const Z_INDEX = {
  tableStickyBody: 10,
  tableStickyHeader: 20,
  tableStickyCorner: 21,
  pageSticky: 30,
  topBar: 40,
  dropdown: 50,
  popover: 60,
  modal: 100,
  toast: 110,
  tooltip: 120,
} as const;

/** Tailwind-friendly class tokens that read from the CSS variables. */
export const zClass = {
  tableStickyBody: "z-[var(--z-table-sticky-body)]",
  tableStickyHeader: "z-[var(--z-table-sticky-header)]",
  tableStickyCorner: "z-[var(--z-table-sticky-corner)]",
  pageSticky: "z-[var(--z-page-sticky)]",
  topBar: "z-[var(--z-top-bar)]",
  dropdown: "z-[var(--z-dropdown)]",
  popover: "z-[var(--z-popover)]",
  modal: "z-[var(--z-modal)]",
  toast: "z-[var(--z-toast)]",
  tooltip: "z-[var(--z-tooltip)]",
} as const;
