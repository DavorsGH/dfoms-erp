"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { inputClassName } from "@/app/dashboard/employees/employee-record-utils";
import {
  TIME_PICKER_HOURS,
  TIME_PICKER_MINUTES,
  emptyTimePickerParts,
  formatTimePickerDisplay,
  parseTimePickerText,
  timePickerMinutes,
  timePickerPartsFromValue,
  valueFromTimePickerParts,
  type TimePickerParts,
} from "@/lib/time-picker";

export type TimePickerFieldProps = {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  "aria-label"?: string;
  className?: string;
};

function scrollColumnToValue(column: HTMLDivElement | null, value: string | undefined) {
  if (!column || !value) {
    return;
  }
  const selected = column.querySelector<HTMLElement>(`[data-value='${value}']`);
  if (!selected) {
    return;
  }
  const top = selected.offsetTop - column.clientHeight / 2 + selected.clientHeight / 2;
  column.scrollTop = Math.max(0, top);
}

function assignRef(ref: Ref<HTMLInputElement>, node: HTMLInputElement | null) {
  if (typeof ref === "function") {
    ref(node);
  } else if (ref) {
    ref.current = node;
  }
}

function rangeMessage(value: string, min?: string, max?: string): string {
  const minutes = timePickerMinutes(value);
  if (minutes == null) {
    return "";
  }
  const minMinutes = min ? timePickerMinutes(min) : null;
  const maxMinutes = max ? timePickerMinutes(max) : null;
  if (minMinutes != null && minutes < minMinutes) {
    return `Choose a time at or after ${formatTimePickerDisplay(min ?? "")}.`;
  }
  if (maxMinutes != null && minutes > maxMinutes) {
    return `Choose a time at or before ${formatTimePickerDisplay(max ?? "")}.`;
  }
  return "";
}

const TimePickerField = forwardRef<HTMLInputElement, TimePickerFieldProps>(
  function TimePickerField(
    {
      value,
      onChange,
      name,
      id,
      required = false,
      disabled = false,
      min,
      max,
      "aria-label": ariaLabel,
      className = "",
    },
    ref,
  ) {
    const anchorRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const hourColumnRef = useRef<HTMLDivElement>(null);
    const minuteColumnRef = useRef<HTMLDivElement>(null);
    const meridiemColumnRef = useRef<HTMLDivElement>(null);
    const reactId = useId();
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState("");
    const [draft, setDraft] = useState<TimePickerParts>(emptyTimePickerParts);
    const [placement, setPlacement] = useState({
      top: 0,
      left: 0,
      width: 280,
    });
    const display = formatTimePickerDisplay(value);
    const shown = editing ? text : display;

    function setInputNode(node: HTMLInputElement | null) {
      inputRef.current = node;
      assignRef(ref, node);
    }

    function commit(next: string) {
      const limit = rangeMessage(next, min, max);
      const input = inputRef.current;
      if (limit) {
        input?.setCustomValidity(limit);
        input?.reportValidity();
        return false;
      }
      input?.setCustomValidity("");
      if (next !== value) {
        flushSync(() => onChange(next));
      }
      setEditing(false);
      setText("");
      return true;
    }

    function closeCancel() {
      setOpen(false);
      setEditing(false);
      setText("");
      setDraft(timePickerPartsFromValue(value));
    }

    function applyDraft() {
      const next = valueFromTimePickerParts(draft);
      if (!next) {
        inputRef.current?.setCustomValidity("Choose hour, minute, and AM/PM.");
        inputRef.current?.reportValidity();
        return;
      }
      if (commit(next)) {
        setOpen(false);
      }
    }

    function clearValue() {
      const input = inputRef.current;
      input?.setCustomValidity("");
      flushSync(() => onChange(""));
      setEditing(false);
      setText("");
      setDraft(emptyTimePickerParts());
      setOpen(false);
    }

    function openPanel() {
      if (disabled) {
        return;
      }
      const parsed = editing ? parseTimePickerText(text) : value;
      setDraft(timePickerPartsFromValue(parsed && parsed !== null ? parsed : value));
      setOpen(true);
    }

    function placePanel() {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      const panelHeight = panelRef.current?.offsetHeight ?? 320;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openAbove = spaceBelow < panelHeight + 8 && rect.top > spaceBelow;
      const top = openAbove
        ? Math.max(8, rect.top - panelHeight - 4)
        : Math.min(rect.bottom + 4, window.innerHeight - panelHeight - 8);
      setPlacement({ top, left, width });
    }

    useLayoutEffect(() => {
      if (!open) {
        return;
      }
      placePanel();
      for (const column of [
        hourColumnRef.current,
        minuteColumnRef.current,
        meridiemColumnRef.current,
      ]) {
        scrollColumnToValue(column, column?.querySelector<HTMLElement>("[data-selected='true']")?.dataset.value);
      }
      hourColumnRef.current?.focus();
    }, [open]);

    useEffect(() => {
      if (!open) {
        return;
      }
      function onPlace() {
        placePanel();
      }
      function onPointerDown(event: PointerEvent) {
        const target = event.target;
        if (!(target instanceof Node)) {
          return;
        }
        if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) {
          return;
        }
        closeCancel();
      }
      window.addEventListener("resize", onPlace);
      window.addEventListener("scroll", onPlace, true);
      document.addEventListener("pointerdown", onPointerDown, true);
      return () => {
        window.removeEventListener("resize", onPlace);
        window.removeEventListener("scroll", onPlace, true);
        document.removeEventListener("pointerdown", onPointerDown, true);
      };
    }, [open, value]);

    function moveInColumn(
      items: readonly string[],
      current: string,
      key: string,
    ): string | null {
      if (items.length === 0) {
        return null;
      }
      const index = items.indexOf(current);
      if (key === "Home") {
        return items[0];
      }
      if (key === "End") {
        return items[items.length - 1];
      }
      if (key === "ArrowDown") {
        return items[index < 0 ? 0 : Math.min(items.length - 1, index + 1)];
      }
      if (key === "ArrowUp") {
        return items[index < 0 ? 0 : Math.max(0, index - 1)];
      }
      return null;
    }

    function onColumnKey(
      event: ReactKeyboardEvent<HTMLDivElement>,
      column: "hour" | "minute" | "meridiem",
    ) {
      if (event.key === "Enter") {
        event.preventDefault();
        applyDraft();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeCancel();
        return;
      }
      const items =
        column === "hour"
          ? TIME_PICKER_HOURS
          : column === "minute"
            ? TIME_PICKER_MINUTES
            : (["AM", "PM"] as const);
      const current =
        column === "hour" ? draft.hour : column === "minute" ? draft.minute : draft.meridiem;
      const next = moveInColumn(items, current, event.key);
      if (!next) {
        return;
      }
      event.preventDefault();
      setDraft((currentDraft) => {
        if (column === "hour") {
          return { ...currentDraft, hour: next };
        }
        if (column === "minute") {
          return { ...currentDraft, minute: next };
        }
        return { ...currentDraft, meridiem: next === "PM" ? "PM" : "AM" };
      });
      const columnNode =
        column === "hour"
          ? hourColumnRef.current
          : column === "minute"
            ? minuteColumnRef.current
            : meridiemColumnRef.current;
      requestAnimationFrame(() => scrollColumnToValue(columnNode, next));
    }

    function onFieldKey(event: ReactKeyboardEvent<HTMLInputElement>) {
      if (!open) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        applyDraft();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeCancel();
      } else if (event.key === "Tab") {
        return;
      } else if (event.key.length === 1) {
        setOpen(false);
      }
    }

    function onBlur(event: React.FocusEvent<HTMLInputElement>) {
      const next = event.relatedTarget;
      if (next instanceof Node && panelRef.current?.contains(next)) {
        return;
      }
      if (!editing) {
        return;
      }
      const parsed = parseTimePickerText(text);
      if (parsed == null) {
        event.currentTarget.setCustomValidity("Enter a time like 8:30 AM, 0830, or 14:00.");
        event.currentTarget.reportValidity();
        return;
      }
      event.currentTarget.setCustomValidity("");
      commit(parsed);
    }

    const panel =
      open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={ariaLabel ? `${ariaLabel} time` : "Select time"}
              className="fixed z-[260] max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
              style={{
                top: placement.top,
                left: placement.left,
                width: placement.width,
              }}
              onMouseDown={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeCancel();
                }
              }}
            >
              <div className="grid grid-cols-3 gap-1">
                <Column
                  ref={hourColumnRef}
                  label="Hour"
                  items={TIME_PICKER_HOURS}
                  selected={draft.hour}
                  onSelect={(hour) => setDraft((current) => ({ ...current, hour }))}
                  onKeyDown={(event) => onColumnKey(event, "hour")}
                />
                <Column
                  ref={minuteColumnRef}
                  label="Min"
                  items={TIME_PICKER_MINUTES}
                  selected={draft.minute}
                  onSelect={(minute) => setDraft((current) => ({ ...current, minute }))}
                  onKeyDown={(event) => onColumnKey(event, "minute")}
                />
                <Column
                  ref={meridiemColumnRef}
                  label="AM/PM"
                  items={["AM", "PM"]}
                  selected={draft.meridiem}
                  onSelect={(meridiem) =>
                    setDraft((current) => ({
                      ...current,
                      meridiem: meridiem === "PM" ? "PM" : "AM",
                    }))
                  }
                  onKeyDown={(event) => onColumnKey(event, "meridiem")}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="px-2 py-1.5 text-sm font-medium text-[#0f2744] hover:underline"
                  onClick={clearValue}
                >
                  Clear
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
                    onClick={closeCancel}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1a3a5c]"
                    onClick={applyDraft}
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null;

    return (
      <div ref={anchorRef} className="relative">
        <input
          ref={setInputNode}
          id={id ?? reactId}
          name={name}
          type="text"
          inputMode="text"
          autoComplete="off"
          disabled={disabled}
          required={required}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="dialog"
          placeholder="Select time"
          value={shown}
          className={`${inputClassName} pr-10 ${className}`}
          onFocus={() => {
            if (disabled) {
              return;
            }
            setEditing(true);
            setText(display);
          }}
          onChange={(event) => {
            event.currentTarget.setCustomValidity("");
            setEditing(true);
            setText(event.target.value);
          }}
          onBlur={onBlur}
          onClick={() => {
            if (!open) {
              openPanel();
            }
          }}
          onKeyDown={onFieldKey}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={ariaLabel ? `Open ${ariaLabel}` : "Open time picker"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[#0f2744] disabled:text-slate-400"
          onMouseDown={(event) => event.preventDefault()}
          onClick={open ? closeCancel : openPanel}
        >
          <ClockIcon />
        </button>
        {panel}
      </div>
    );
  },
);

export default TimePickerField;

const Column = forwardRef<
  HTMLDivElement,
  {
    label: string;
    items: readonly string[];
    selected: string;
    onSelect: (value: string) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  }
>(function Column({ label, items, selected, onSelect, onKeyDown }, ref) {
  return (
    <div>
      <p className="px-1 pb-1 text-xs font-medium text-slate-500">{label}</p>
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative max-h-44 overflow-y-auto rounded-md border border-slate-200"
      >
        {items.map((item) => {
          const isSelected = item === selected;
          return (
            <button
              key={item}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={isSelected}
              data-selected={isSelected ? "true" : "false"}
              data-value={item}
              className={`flex min-h-10 w-full items-center justify-center text-base ${
                isSelected
                  ? "bg-[#0f2744] font-medium text-white"
                  : "text-slate-800 hover:bg-slate-100"
              }`}
              onClick={() => onSelect(item)}
            >
              {item}
            </button>
          );
        })}
      </div>
    </div>
  );
});

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 2" strokeLinecap="round" />
    </svg>
  );
}
