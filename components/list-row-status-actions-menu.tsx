"use client";

import { useEffect, useRef, useState } from "react";

export type ListRowStatusActionItem<T extends string = string> = {
  action: T;
  label: string;
  confirmMessage: string;
};

type ListRowStatusActionsMenuProps<T extends string> = {
  items: ListRowStatusActionItem<T>[];
  disabled?: boolean;
  onSelect: (item: ListRowStatusActionItem<T>) => void;
  buttonClassName?: string;
  menuItemClassName?: string;
};

const defaultButtonClassName =
  "rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const defaultMenuItemClassName =
  "block w-full px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50";

export default function ListRowStatusActionsMenu<T extends string>({
  items,
  disabled = false,
  onSelect,
  buttonClassName = defaultButtonClassName,
  menuItemClassName = defaultMenuItemClassName,
}: ListRowStatusActionsMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={buttonClassName}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Actions ▾
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[11rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              className={menuItemClassName}
              onClick={() => {
                setOpen(false);
                onSelect(item);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
