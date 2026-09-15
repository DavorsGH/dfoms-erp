"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FLOATING_UI_DESKTOP_MIN_WIDTH_PX,
  type FloatingUiAvoidanceInsets,
} from "@/components/floating-ui-avoidance";

export const ASSISTANT_BUBBLE_SIZE_PX = 64;
const DRAG_CLICK_THRESHOLD_PX = 6;
const STORAGE_KEY_MOBILE = "davors-erp-assistant-bubble-v1-mobile";
const STORAGE_KEY_DESKTOP = "davors-erp-assistant-bubble-v1-desktop";

export type AssistantBubbleSide = "left" | "right";

export type AssistantBubblePosition = {
  side: AssistantBubbleSide;
  top: number;
};

type ViewportMode = "mobile" | "desktop";

function getViewportMode(width: number): ViewportMode {
  return width >= FLOATING_UI_DESKTOP_MIN_WIDTH_PX ? "desktop" : "mobile";
}

function getEdgeMargin(mode: ViewportMode): number {
  return mode === "desktop" ? 24 : 16;
}

function storageKeyForMode(mode: ViewportMode): string {
  return mode === "desktop" ? STORAGE_KEY_DESKTOP : STORAGE_KEY_MOBILE;
}

function readSavedPosition(mode: ViewportMode): AssistantBubblePosition | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKeyForMode(mode));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as AssistantBubblePosition;
    if (
      (parsed.side === "left" || parsed.side === "right") &&
      typeof parsed.top === "number" &&
      Number.isFinite(parsed.top)
    ) {
      return parsed;
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

function writeSavedPosition(
  mode: ViewportMode,
  position: AssistantBubblePosition,
): void {
  try {
    window.localStorage.setItem(
      storageKeyForMode(mode),
      JSON.stringify(position),
    );
  } catch {
    // ignore quota / private mode
  }
}

function safeAreaBottom(): number {
  if (typeof window === "undefined") {
    return 0;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("env(safe-area-inset-bottom)")
    .trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampTop(
  top: number,
  viewportHeight: number,
  bottomInset: number,
  mode: ViewportMode,
): number {
  const margin = getEdgeMargin(mode);
  const minTop = margin;
  const maxTop =
    viewportHeight -
    ASSISTANT_BUBBLE_SIZE_PX -
    margin -
    bottomInset -
    safeAreaBottom();
  return Math.min(Math.max(top, minTop), Math.max(minTop, maxTop));
}

export function computeAssistantBubbleDefaultPosition(
  insets: FloatingUiAvoidanceInsets,
  viewportWidth: number,
  viewportHeight: number,
  mode: ViewportMode,
): AssistantBubblePosition {
  const margin = getEdgeMargin(mode);
  const bottomReserve =
    insets.bottom + margin + ASSISTANT_BUBBLE_SIZE_PX + safeAreaBottom();
  const top = clampTop(
    viewportHeight - bottomReserve,
    viewportHeight,
    insets.bottom,
    mode,
  );

  const rightHeavy =
    insets.right > Math.max(insets.left, margin) &&
    insets.right > viewportWidth * 0.28;
  const side: AssistantBubbleSide = rightHeavy ? "left" : "right";

  return { side, top };
}

function snapSide(centerX: number, viewportWidth: number): AssistantBubbleSide {
  return centerX < viewportWidth / 2 ? "left" : "right";
}

export function useAssistantBubblePosition(
  insets: FloatingUiAvoidanceInsets,
) {
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");
  const [viewportSize, setViewportSize] = useState({ width: 1024, height: 768 });
  const [savedPosition, setSavedPosition] = useState<AssistantBubblePosition | null>(
    null,
  );
  const [dragPosition, setDragPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    originLeft: 0,
    originTop: 0,
    moved: false,
  });

  useEffect(() => {
    function syncViewport() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const mode = getViewportMode(width);
      setViewportSize({ width, height });
      setViewportMode(mode);
      setSavedPosition(readSavedPosition(mode));
      setDragPosition(null);
    }

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  const defaultPosition = computeAssistantBubbleDefaultPosition(
    insets,
    viewportSize.width,
    viewportSize.height,
    viewportMode,
  );

  const resolvedPosition = savedPosition ?? defaultPosition;

  const getAnchorPosition = useCallback((): { left: number; top: number } => {
    const margin = getEdgeMargin(viewportMode);
    const top = clampTop(
      resolvedPosition.top,
      viewportSize.height,
      insets.bottom,
      viewportMode,
    );

    if (resolvedPosition.side === "left") {
      return { left: margin + insets.left, top };
    }

    return {
      left:
        viewportSize.width -
        ASSISTANT_BUBBLE_SIZE_PX -
        margin -
        insets.right,
      top,
    };
  }, [
    insets.bottom,
    insets.left,
    insets.right,
    resolvedPosition.side,
    resolvedPosition.top,
    viewportMode,
    viewportSize.height,
    viewportSize.width,
  ]);

  const beginDrag = useCallback(
    (clientX: number, clientY: number, pointerId: number) => {
      const anchor = dragPosition ?? getAnchorPosition();
      dragRef.current = {
        pointerId,
        startX: clientX,
        startY: clientY,
        originLeft: anchor.left,
        originTop: anchor.top,
        moved: false,
      };
      setIsDragging(true);
    },
    [dragPosition, getAnchorPosition],
  );

  const moveDrag = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      const deltaX = clientX - drag.startX;
      const deltaY = clientY - drag.startY;

      if (
        !drag.moved &&
        Math.hypot(deltaX, deltaY) >= DRAG_CLICK_THRESHOLD_PX
      ) {
        drag.moved = true;
      }

      if (!drag.moved) {
        return;
      }

      const margin = getEdgeMargin(viewportMode);
      const maxLeft =
        viewportSize.width - ASSISTANT_BUBBLE_SIZE_PX - margin;
      const maxTop =
        viewportSize.height -
        ASSISTANT_BUBBLE_SIZE_PX -
        margin -
        insets.bottom -
        safeAreaBottom();

      setDragPosition({
        left: Math.min(Math.max(drag.originLeft + deltaX, margin), maxLeft),
        top: Math.min(Math.max(drag.originTop + deltaY, margin), maxTop),
      });
    },
    [insets.bottom, viewportMode, viewportSize.height, viewportSize.width],
  );

  const endDrag = useCallback((): boolean => {
    const drag = dragRef.current;
    const wasDrag = drag.moved;
    setIsDragging(false);
    dragRef.current.pointerId = -1;

    if (!wasDrag || !dragPosition) {
      setDragPosition(null);
      return false;
    }

    const margin = getEdgeMargin(viewportMode);
    const centerX = dragPosition.left + ASSISTANT_BUBBLE_SIZE_PX / 2;
    const side = snapSide(centerX, viewportSize.width);
    const top = clampTop(
      dragPosition.top,
      viewportSize.height,
      insets.bottom,
      viewportMode,
    );

    const next: AssistantBubblePosition = { side, top };
    setSavedPosition(next);
    writeSavedPosition(viewportMode, next);
    setDragPosition(null);
    return true;
  }, [
    dragPosition,
    insets.bottom,
    viewportMode,
    viewportSize.height,
    viewportSize.width,
  ]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      beginDrag(event.clientX, event.clientY, event.pointerId);
    },
    [beginDrag],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (dragRef.current.pointerId !== event.pointerId) {
        return;
      }
      moveDrag(event.clientX, event.clientY);
    },
    [moveDrag],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>): boolean => {
      if (dragRef.current.pointerId !== event.pointerId) {
        return false;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return endDrag();
    },
    [endDrag],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (dragRef.current.pointerId !== event.pointerId) {
        return;
      }
      setIsDragging(false);
      setDragPosition(null);
      dragRef.current.pointerId = -1;
    },
    [],
  );

  const anchor = dragPosition ?? getAnchorPosition();
  const resolvedSide = dragPosition
    ? snapSide(anchor.left + ASSISTANT_BUBBLE_SIZE_PX / 2, viewportSize.width)
    : resolvedPosition.side;

  const fixedStyle: { left: number; top: number } = {
    left: anchor.left,
    top: anchor.top,
  };

  const panelAnchorClass = resolvedSide === "left" ? "left-0" : "right-0";

  return {
    viewportMode,
    isDragging,
    resolvedSide,
    panelAnchorClass,
    fixedStyle,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    dragHandleStyle: { touchAction: "none" as const },
  };
}
