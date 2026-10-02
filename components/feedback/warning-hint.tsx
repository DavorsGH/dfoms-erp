"use client";

import { useEffect, useId, useRef, useState } from "react";

export type WarningHintTone = "amber" | "red";

export type WarningHintProps = {
  title: string;
  description: string;
  ariaLabel: string;
  tone?: WarningHintTone;
  className?: string;
};

const TONE_CLASS: Record<WarningHintTone, string> = {
  amber: "text-amber-600",
  red: "text-red-600",
};

export function WarningHint({
  title,
  description,
  ariaLabel,
  tone = "amber",
  className,
}: WarningHintProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={className ? `relative inline-flex ${className}` : "relative inline-flex"}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={`inline-flex shrink-0 items-center justify-center rounded p-0.5 text-sm leading-none hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f2744]/30 ${TONE_CLASS[tone]}`}
      >
        <span aria-hidden="true">⚠</span>
      </button>
      {open ? (
        <div
          id={popoverId}
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-md border border-slate-200 bg-white p-3 text-left shadow-lg"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <p className="text-sm font-medium text-[#0f2744]">{title}</p>
          <p className="mt-1 text-sm text-slate-700">{description}</p>
        </div>
      ) : null}
    </div>
  );
}
