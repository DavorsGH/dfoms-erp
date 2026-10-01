"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
) {
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active || !containerRef.current) {
      return;
    }

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const first = focusables[0];
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || focusables.length === 0) {
        return;
      }
      const currentIndex = focusables.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1)
        : (currentIndex >= focusables.length - 1 ? 0 : currentIndex + 1);
      focusables[nextIndex]?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [active, containerRef]);
}
