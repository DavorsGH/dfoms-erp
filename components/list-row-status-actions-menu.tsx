"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

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
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function positionMenu() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
        minWidth: "11rem",
      });
    }

    positionMenu();

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
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

    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="inline-block">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={buttonClassName}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Actions ▾
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={menuStyle}
              className="z-[80] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
