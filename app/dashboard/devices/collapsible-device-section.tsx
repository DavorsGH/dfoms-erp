"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const STORAGE_PREFIX = "dfoms.devices.section.";

export default function CollapsibleDeviceSection({
  storageKey,
  title,
  summary,
  defaultOpen,
  children,
  tone = "default",
  meta,
}: {
  storageKey: string;
  title: string;
  summary?: string;
  defaultOpen: boolean;
  children: ReactNode;
  tone?: "default" | "warning";
  meta?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const storedPreference = useRef<boolean | null>(null);
  const appliedLoadedDefault = useRef(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
      if (stored === "open" || stored === "closed") {
        storedPreference.current = stored === "open";
        setOpen(stored === "open");
      }
    } catch {
      storedPreference.current = null;
    }
  }, [storageKey]);

  useEffect(() => {
    if (storedPreference.current != null || appliedLoadedDefault.current) {
      return;
    }
    if (defaultOpen) {
      appliedLoadedDefault.current = true;
      setOpen(true);
    }
  }, [defaultOpen]);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        localStorage.setItem(
          `${STORAGE_PREFIX}${storageKey}`,
          next ? "open" : "closed",
        );
      } catch {
        /* private mode */
      }
      return next;
    });
  }

  const border =
    tone === "warning" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white";

  return (
    <section className={`rounded-lg border shadow-sm ${border}`}>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
        aria-expanded={open}
      >
        <span>
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-base font-semibold text-[#0f2744]">{title}</span>
            {meta}
          </span>
          {summary ? (
            <span className="mt-0.5 block text-sm text-slate-600">{summary}</span>
          ) : null}
        </span>
        <span className="text-slate-500" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? <div className="border-t border-slate-200 px-6 py-4">{children}</div> : null}
    </section>
  );
}
