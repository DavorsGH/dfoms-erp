"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

/** Gap between registered fixed UI and floating controls (e.g. assistant bubble). */
export const FLOATING_UI_AVOIDANCE_GAP_PX = 12;

/** Match Tailwind `lg:` — separate bubble memory for mobile vs desktop. */
export const FLOATING_UI_DESKTOP_MIN_WIDTH_PX = 1024;

type Edge = "left" | "right";

type FloatingUiAvoidanceContextValue = {
  registerBottom: (id: string, height: number) => void;
  unregisterBottom: (id: string) => void;
  registerEdge: (id: string, edge: Edge, insetPx: number) => void;
  unregisterEdge: (id: string) => void;
  bottomInsetPx: number;
  leftInsetPx: number;
  rightInsetPx: number;
};

const FloatingUiAvoidanceContext =
  createContext<FloatingUiAvoidanceContextValue | null>(null);

/** @deprecated Use FloatingUiAvoidanceProvider */
export const StickyBottomBarProvider = FloatingUiAvoidanceProvider;

export function FloatingUiAvoidanceProvider({ children }: { children: ReactNode }) {
  const [bottomHeights, setBottomHeights] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [edgeInsets, setEdgeInsets] = useState<
    Map<string, { edge: Edge; insetPx: number }>
  >(() => new Map());

  const registerBottom = useCallback((id: string, height: number) => {
    setBottomHeights((current) => {
      const next = new Map(current);
      if (height <= 0) {
        next.delete(id);
      } else {
        next.set(id, height);
      }
      return next;
    });
  }, []);

  const unregisterBottom = useCallback((id: string) => {
    setBottomHeights((current) => {
      if (!current.has(id)) {
        return current;
      }
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);

  const registerEdge = useCallback(
    (id: string, edge: Edge, insetPx: number) => {
      setEdgeInsets((current) => {
        const next = new Map(current);
        if (insetPx <= 0) {
          next.delete(id);
        } else {
          next.set(id, { edge, insetPx });
        }
        return next;
      });
    },
    [],
  );

  const unregisterEdge = useCallback((id: string) => {
    setEdgeInsets((current) => {
      if (!current.has(id)) {
        return current;
      }
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);

  const bottomInsetPx = useMemo(() => {
    if (bottomHeights.size === 0) {
      return 0;
    }
    return Math.max(...bottomHeights.values());
  }, [bottomHeights]);

  const leftInsetPx = useMemo(() => {
    let max = 0;
    for (const entry of edgeInsets.values()) {
      if (entry.edge === "left") {
        max = Math.max(max, entry.insetPx);
      }
    }
    return max;
  }, [edgeInsets]);

  const rightInsetPx = useMemo(() => {
    let max = 0;
    for (const entry of edgeInsets.values()) {
      if (entry.edge === "right") {
        max = Math.max(max, entry.insetPx);
      }
    }
    return max;
  }, [edgeInsets]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--app-floating-ui-bottom-inset",
      `${bottomInsetPx}px`,
    );
    root.style.setProperty(
      "--app-floating-ui-left-inset",
      `${leftInsetPx}px`,
    );
    root.style.setProperty(
      "--app-floating-ui-right-inset",
      `${rightInsetPx}px`,
    );
    return () => {
      root.style.removeProperty("--app-floating-ui-bottom-inset");
      root.style.removeProperty("--app-floating-ui-left-inset");
      root.style.removeProperty("--app-floating-ui-right-inset");
    };
  }, [bottomInsetPx, leftInsetPx, rightInsetPx]);

  const value = useMemo(
    () => ({
      registerBottom,
      unregisterBottom,
      registerEdge,
      unregisterEdge,
      bottomInsetPx,
      leftInsetPx,
      rightInsetPx,
    }),
    [
      registerBottom,
      unregisterBottom,
      registerEdge,
      unregisterEdge,
      bottomInsetPx,
      leftInsetPx,
      rightInsetPx,
    ],
  );

  return (
    <FloatingUiAvoidanceContext.Provider value={value}>
      {children}
    </FloatingUiAvoidanceContext.Provider>
  );
}

export type FloatingUiAvoidanceInsets = {
  bottom: number;
  left: number;
  right: number;
};

export function useFloatingUiAvoidanceInsets(
  gapPx: number = FLOATING_UI_AVOIDANCE_GAP_PX,
): FloatingUiAvoidanceInsets {
  const context = useContext(FloatingUiAvoidanceContext);
  const bottom = context?.bottomInsetPx ?? 0;
  const left = context?.leftInsetPx ?? 0;
  const right = context?.rightInsetPx ?? 0;
  return {
    bottom: bottom > 0 ? bottom + gapPx : 0,
    left: left > 0 ? left + gapPx : 0,
    right: right > 0 ? right + gapPx : 0,
  };
}

/** @deprecated Use useFloatingUiAvoidanceInsets().bottom */
export function useStickyBottomBarOffset(
  gapPx: number = FLOATING_UI_AVOIDANCE_GAP_PX,
): number {
  return useFloatingUiAvoidanceInsets(gapPx).bottom;
}

/** @deprecated Use FloatingUiAvoidanceProvider */
export const STICKY_BOTTOM_BAR_FLOATING_UI_GAP_PX = FLOATING_UI_AVOIDANCE_GAP_PX;

/**
 * Fixed bottom bar wrapper. Registers visible height so floating UI can offset above it.
 */
export function StickyBottomBar({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  const id = useId();
  const context = useContext(FloatingUiAvoidanceContext);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!context) {
      return;
    }

    const element = ref.current;
    if (!element) {
      return;
    }

    const report = () => {
      const height = element.getBoundingClientRect().height;
      context.registerBottom(id, height);
    };

    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();

    return () => {
      observer.disconnect();
      context.unregisterBottom(id);
    };
  }, [context, id]);

  return (
    <div
      ref={ref}
      data-floating-ui-avoidance="bottom"
      className={className}
      {...props}
    >
      {children}
    </div>
  );
}

type StickyEdgePanelProps = ComponentProps<"div"> & {
  edge: Edge;
};

/**
 * Sticky side panel wrapper (e.g. POS desktop cart column). Registers how much
 * horizontal space it occupies from the given viewport edge.
 */
export function StickyEdgePanel({
  edge,
  children,
  className,
  ...props
}: StickyEdgePanelProps) {
  const id = useId();
  const context = useContext(FloatingUiAvoidanceContext);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!context) {
      return;
    }

    const element = ref.current;
    if (!element) {
      return;
    }

    const report = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        context.unregisterEdge(id);
        return;
      }

      const viewportWidth = window.innerWidth;
      let insetPx = 0;

      if (edge === "right") {
        if (rect.left < viewportWidth - 8) {
          insetPx = Math.max(0, viewportWidth - rect.left);
        }
      } else if (rect.right > 8) {
        insetPx = Math.max(0, rect.right);
      }

      context.registerEdge(id, edge, insetPx);
    };

    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener("scroll", report, true);
    window.addEventListener("resize", report);
    report();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", report, true);
      window.removeEventListener("resize", report);
      context.unregisterEdge(id);
    };
  }, [context, edge, id]);

  return (
    <div
      ref={ref}
      data-floating-ui-avoidance={edge}
      className={className}
      {...props}
    >
      {children}
    </div>
  );
}
