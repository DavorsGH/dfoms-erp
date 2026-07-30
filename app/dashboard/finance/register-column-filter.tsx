"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { formatGHS } from "./income-register-utils";

/** null = no filter (all values). Non-null Set = only these values pass. */
export type RegisterColumnFilterValue = Set<string> | null;

export function blankFilterLabel(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "(Blank)";
}

export function collectDistinctColumnValues(
  values: Array<string | null | undefined>,
): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    unique.add(blankFilterLabel(value));
  }
  return [...unique].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

export function columnValuePassesFilter(
  raw: string | null | undefined,
  filter: RegisterColumnFilterValue,
): boolean {
  if (!filter) {
    return true;
  }
  return filter.has(blankFilterLabel(raw));
}

export function isColumnFilterActive(filter: RegisterColumnFilterValue): boolean {
  return filter !== null;
}

type RegisterColumnFilterHeaderProps = {
  label: string;
  options: string[];
  applied: RegisterColumnFilterValue;
  onApply: (next: RegisterColumnFilterValue) => void;
};

export function RegisterColumnFilterHeader({
  label,
  options,
  applied,
  onApply,
}: RegisterColumnFilterHeaderProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Set<string>>(() => new Set(options));
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const active = isColumnFilterActive(applied);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSearch("");
    setDraft(applied ? new Set(applied) : new Set(options));

    function positionPanel() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const width = 256;
      const left = Math.min(
        Math.max(8, rect.left),
        window.innerWidth - width - 8,
      );
      setPanelStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left,
        width,
      });
    }

    positionPanel();

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, applied, options]);

  const visibleOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return options;
    }
    return options.filter((option) => option.toLowerCase().includes(query));
  }, [options, search]);

  const allVisibleChecked =
    visibleOptions.length > 0 &&
    visibleOptions.every((option) => draft.has(option));

  function toggleOption(option: string) {
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(option)) {
        next.delete(option);
      } else {
        next.add(option);
      }
      return next;
    });
  }

  function selectAllVisible() {
    setDraft((current) => {
      const next = new Set(current);
      for (const option of visibleOptions) {
        next.add(option);
      }
      return next;
    });
  }

  function clearVisible() {
    setDraft((current) => {
      const next = new Set(current);
      for (const option of visibleOptions) {
        next.delete(option);
      }
      return next;
    });
  }

  function applyDraft() {
    if (draft.size === 0) {
      onApply(new Set());
    } else if (
      draft.size >= options.length &&
      options.every((option) => draft.has(option))
    ) {
      onApply(null);
    } else {
      onApply(new Set(draft));
    }
    setOpen(false);
  }

  return (
    <div className="relative inline-flex items-center gap-1.5">
      <span>{label}</span>
      <button
        ref={buttonRef}
        type="button"
        className={`inline-flex h-5 w-5 items-center justify-center rounded transition-colors ${
          active
            ? "bg-white/20 text-white"
            : "text-white/80 hover:bg-white/10 hover:text-white"
        }`}
        aria-label={`Filter ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <FilterGlyph active={active} />
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={`Filter ${label}`}
              style={panelStyle}
              className="z-[80] rounded-md border border-slate-200 bg-white text-slate-900 shadow-lg"
            >
              <div className="border-b border-slate-200 p-2">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search…"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-xs">
                <button
                  type="button"
                  className="font-medium text-[#0f2744] hover:underline"
                  onClick={selectAllVisible}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="font-medium text-slate-600 hover:underline"
                  onClick={clearVisible}
                >
                  Clear
                </button>
              </div>

              <div className="max-h-52 overflow-y-auto px-2 py-1">
                {visibleOptions.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-slate-500">No matches.</p>
                ) : (
                  <>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                        checked={allVisibleChecked}
                        onChange={() => {
                          if (allVisibleChecked) {
                            clearVisible();
                          } else {
                            selectAllVisible();
                          }
                        }}
                      />
                      <span className="font-medium text-slate-700">
                        (Select All)
                      </span>
                    </label>
                    {visibleOptions.map((option) => (
                      <label
                        key={option}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                          checked={draft.has(option)}
                          onChange={() => toggleOption(option)}
                        />
                        <span className="truncate">{option}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#16355c]"
                  onClick={applyDraft}
                >
                  OK
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function FilterGlyph({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="currentColor"
      aria-hidden
    >
      {active ? (
        <path d="M1.5 2.5h13l-5 6.2V13l-3 1.5V8.7L1.5 2.5z" />
      ) : (
        <path
          fillRule="evenodd"
          d="M2.2 3.25a.75.75 0 0 1 .75-.75h10.1a.75.75 0 0 1 .55 1.26L9.4 9.1v3.15a.75.75 0 0 1-1.1.66l-1.5-.8A.75.75 0 0 1 6.4 12.25V9.1L2.4 3.76a.75.75 0 0 1-.2-.51Zm1.7.75 3.55 4.8a.75.75 0 0 1 .15.45v2.55l.9.48V9.25c0-.16.05-.32.15-.45L11.9 4H3.9Z"
          clipRule="evenodd"
        />
      )}
    </svg>
  );
}

type RegisterFilteredTotalProps = {
  label: string;
  total: number;
  visibleCount: number;
  totalCount: number;
};

/** Footer total for currently visible (filtered) register rows. */
export function RegisterFilteredTotal({
  label,
  total,
  visibleCount,
  totalCount,
}: RegisterFilteredTotalProps) {
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800"
      aria-live="polite"
    >
      <span className="text-slate-500">
        Showing {visibleCount} of {totalCount}
      </span>
      <span>
        <span className="text-slate-500">{label} </span>
        <span className="font-semibold tabular-nums text-[#0f2744]">
          {formatGHS(total)}
        </span>
      </span>
    </div>
  );
}
