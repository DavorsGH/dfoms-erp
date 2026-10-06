"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 300;

export type TooltipVariant = "info" | "blocked";

type TooltipSide = "top" | "bottom" | "left" | "right";

type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  /** Preferred placement; flips to stay in viewport. */
  side?: TooltipSide;
  className?: string;
  /** `blocked` = disabled-action reasons; `info` = default help text. */
  variant?: TooltipVariant;
};

const VARIANT_STYLES: Record<
  TooltipVariant,
  { panel: string; arrow: string; icon?: ReactNode }
> = {
  info: {
    panel:
      "border-[#0f2744] bg-[#0f2744] text-white shadow-lg",
    arrow: "border-[#0f2744] bg-[#0f2744]",
  },
  blocked: {
    panel:
      "border-[#F59E0B] bg-[#FEF3C7] text-[#78350F] shadow-md",
    arrow: "border-[#F59E0B] bg-[#FEF3C7]",
    icon: (
      <svg
        aria-hidden
        className="mt-0.5 h-4 w-4 shrink-0 text-[#D97706]"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 3.01-1.742 3.01H4.42c-1.53 0-2.492-1.676-1.743-3.01l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
};

/** Disabled native controls ignore pointer events; route hover/focus through the trigger wrapper. */
function prepareTooltipTriggerChild(children: ReactNode): {
  node: ReactNode;
  wrapFocusable: boolean;
} {
  const child = Children.only(children);
  if (!isValidElement(child)) {
    return { node: children, wrapFocusable: false };
  }

  type ButtonTriggerProps = {
    disabled?: boolean;
    className?: string;
    onClick?: (event: {
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void;
  };

  const props = child.props as ButtonTriggerProps;

  if (child.type !== "button" || !props.disabled) {
    return { node: children, wrapFocusable: false };
  }

  const existingClassName = props.className ?? "";
  const node = cloneElement(child as ReactElement<ButtonTriggerProps>, {
    disabled: undefined,
    "aria-disabled": true,
    tabIndex: -1,
    className: `${existingClassName} pointer-events-none`.trim(),
    onClick: (event: {
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => {
      event.preventDefault();
      event.stopPropagation();
      props.onClick?.(event);
    },
  } as Partial<ButtonTriggerProps> & HTMLAttributes<HTMLButtonElement>);

  return { node, wrapFocusable: true };
}

function isTouchPrimary(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function computeTooltipPosition(input: {
  trigger: DOMRect;
  tooltipWidth: number;
  tooltipHeight: number;
  preferred: TooltipSide;
}): { top: number; left: number; side: TooltipSide } {
  const margin = 8;
  const arrow = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const candidates: TooltipSide[] = [
    input.preferred,
    "top",
    "bottom",
    "left",
    "right",
  ];

  const uniqueCandidates = [...new Set(candidates)];

  for (const side of uniqueCandidates) {
    let top = 0;
    let left = 0;

    if (side === "top") {
      top = input.trigger.top - input.tooltipHeight - arrow - margin;
      left =
        input.trigger.left +
        input.trigger.width / 2 -
        input.tooltipWidth / 2;
    } else if (side === "bottom") {
      top = input.trigger.bottom + arrow + margin;
      left =
        input.trigger.left +
        input.trigger.width / 2 -
        input.tooltipWidth / 2;
    } else if (side === "left") {
      top =
        input.trigger.top +
        input.trigger.height / 2 -
        input.tooltipHeight / 2;
      left = input.trigger.left - input.tooltipWidth - arrow - margin;
    } else {
      top =
        input.trigger.top +
        input.trigger.height / 2 -
        input.tooltipHeight / 2;
      left = input.trigger.right + arrow + margin;
    }

    left = Math.max(margin, Math.min(left, vw - input.tooltipWidth - margin));
    top = Math.max(margin, Math.min(top, vh - input.tooltipHeight - margin));

    const fits =
      top >= margin &&
      left >= margin &&
      top + input.tooltipHeight <= vh - margin &&
      left + input.tooltipWidth <= vw - margin;

    if (fits) {
      return { top, left, side };
    }
  }

  const fallbackSide = input.preferred;
  let top = input.trigger.bottom + arrow + margin;
  let left =
    input.trigger.left + input.trigger.width / 2 - input.tooltipWidth / 2;
  left = Math.max(margin, Math.min(left, vw - input.tooltipWidth - margin));
  top = Math.max(margin, Math.min(top, vh - input.tooltipHeight - margin));
  return { top, left, side: fallbackSide };
}

function arrowStyle(
  resolvedSide: TooltipSide,
  variant: TooltipVariant,
): CSSProperties {
  const base =
    variant === "info"
      ? { borderColor: "#0f2744", backgroundColor: "#0f2744" }
      : { borderColor: "#F59E0B", backgroundColor: "#FEF3C7" };

  if (resolvedSide === "top") {
    return {
      ...base,
      bottom: -5,
      left: "50%",
      marginLeft: -5,
      borderTop: "none",
      borderLeft: "none",
    };
  }
  if (resolvedSide === "bottom") {
    return {
      ...base,
      top: -5,
      left: "50%",
      marginLeft: -5,
      borderBottom: "none",
      borderRight: "none",
    };
  }
  if (resolvedSide === "left") {
    return {
      ...base,
      right: -5,
      top: "50%",
      marginTop: -5,
      borderBottom: "none",
      borderLeft: "none",
    };
  }
  return {
    ...base,
    left: -5,
    top: "50%",
    marginTop: -5,
    borderTop: "none",
    borderRight: "none",
  };
}

export default function Tooltip({
  content,
  children,
  side = "top",
  className = "",
  variant = "info",
}: TooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const pointerInsideRef = useRef(false);
  const touchModeRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [positionReady, setPositionReady] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({
    top: 0,
    left: 0,
    opacity: 0,
    pointerEvents: "none",
  });
  const [resolvedSide, setResolvedSide] = useState<TooltipSide>(side);

  const variantStyles = VARIANT_STYLES[variant];

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearShowTimer();
    clearHideTimer();
    pointerInsideRef.current = false;
    setOpen(false);
    setPositionReady(false);
  }, [clearHideTimer, clearShowTimer]);

  const scheduleShow = useCallback(
    (immediate = false) => {
      if (content == null || content === "") {
        return;
      }
      clearHideTimer();
      clearShowTimer();
      if (immediate) {
        setOpen(true);
        return;
      }
      showTimerRef.current = window.setTimeout(() => {
        setOpen(true);
      }, SHOW_DELAY_MS);
    },
    [clearHideTimer, clearShowTimer, content],
  );

  const scheduleHide = useCallback(() => {
    clearShowTimer();
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      if (!pointerInsideRef.current) {
        setOpen(false);
        setPositionReady(false);
      }
    }, 80);
  }, [clearHideTimer, clearShowTimer]);

  useEffect(() => {
    setMounted(true);
    touchModeRef.current = isTouchPrimary();
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) {
      return;
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const position = computeTooltipPosition({
      trigger: triggerRect,
      tooltipWidth: panelRect.width,
      tooltipHeight: panelRect.height,
      preferred: side,
    });

    setResolvedSide(position.side);
    setStyle({
      top: position.top,
      left: position.left,
      opacity: 1,
      pointerEvents: "auto",
    });
    setPositionReady(true);
  }, [open, content, side]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hide();
      }
    };

    const reposition = () => {
      if (!triggerRef.current || !panelRef.current) {
        return;
      }
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const panelRect = panelRef.current.getBoundingClientRect();
      const position = computeTooltipPosition({
        trigger: triggerRect,
        tooltipWidth: panelRect.width,
        tooltipHeight: panelRect.height,
        preferred: side,
      });
      setResolvedSide(position.side);
      setStyle({
        top: position.top,
        left: position.left,
        opacity: 1,
        pointerEvents: "auto",
      });
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [hide, open, side]);

  useEffect(() => {
    if (!open || !touchModeRef.current) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      hide();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [hide, open]);

  const triggerChild = useMemo(
    () => prepareTooltipTriggerChild(children),
    [children],
  );

  if (content == null || content === "") {
    return <>{children}</>;
  }

  const panel =
    open && mounted ? (
      <div
        ref={panelRef}
        id={tooltipId}
        role="tooltip"
        style={style}
        className={`pointer-events-auto fixed z-[99999] w-max max-w-[min(320px,calc(100vw-16px))] rounded-md border px-3 py-2 text-sm leading-snug ${variantStyles.panel} ${
          positionReady ? "" : "invisible"
        }`}
        onMouseEnter={() => {
          pointerInsideRef.current = true;
          clearHideTimer();
        }}
        onMouseLeave={() => {
          pointerInsideRef.current = false;
          scheduleHide();
        }}
      >
        <div
          aria-hidden
          className={`absolute h-2.5 w-2.5 rotate-45 border ${variantStyles.arrow}`}
          style={arrowStyle(resolvedSide, variant)}
        />
        <div className="relative flex gap-2 whitespace-normal break-words">
          {variantStyles.icon}
          <span className="min-w-0 flex-1">{content}</span>
        </div>
      </div>
    ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className={`inline-flex max-w-full align-middle ${className}`.trim()}
        tabIndex={triggerChild.wrapFocusable ? 0 : undefined}
        aria-describedby={open && positionReady ? tooltipId : undefined}
        onMouseEnter={() => {
          if (touchModeRef.current) {
            return;
          }
          pointerInsideRef.current = true;
          scheduleShow(false);
        }}
        onMouseLeave={(event) => {
          if (touchModeRef.current) {
            return;
          }
          const related = event.relatedTarget as Node | null;
          if (panelRef.current?.contains(related)) {
            return;
          }
          pointerInsideRef.current = false;
          scheduleHide();
        }}
        onFocus={() => {
          scheduleShow(true);
        }}
        onBlur={(event) => {
          const related = event.relatedTarget as Node | null;
          if (panelRef.current?.contains(related)) {
            return;
          }
          hide();
        }}
        onClick={() => {
          if (!touchModeRef.current) {
            return;
          }
          setOpen((current) => !current);
        }}
      >
        {triggerChild.node}
      </span>
      {panel ? createPortal(panel, document.body) : null}
    </>
  );
}
