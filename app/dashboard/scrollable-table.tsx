type ScrollableTableProps = {
  children: React.ReactNode;
};

/** Use with ScrollableTable on every register/list screen (Finance, HR, Operations, etc.). */
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
      <div className="min-w-0 max-h-[calc(100vh-300px)] overflow-auto">
        {children}
      </div>
    </section>
  );
}
