"use client";

import { useState, type ReactNode } from "react";

type InventoryCollapsibleHistorySectionProps = {
  title: string;
  count: number;
  defaultExpanded?: boolean;
  children: ReactNode;
};

function CollapseChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={20}
      height={20}
      className={`shrink-0 text-slate-600 transition-transform duration-150 ${
        expanded ? "rotate-90" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export default function InventoryCollapsibleHistorySection({
  title,
  count,
  defaultExpanded = false,
  children,
}: InventoryCollapsibleHistorySectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex min-h-11 w-full cursor-pointer items-center rounded-md py-2.5 text-left transition-colors hover:bg-slate-50"
      >
        <span className="inline-flex items-center gap-2 text-lg font-semibold text-[#0f2744]">
          {title} ({count})
          <CollapseChevronIcon expanded={expanded} />
        </span>
      </button>
      {expanded ? children : null}
    </div>
  );
}
