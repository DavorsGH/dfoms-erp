"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

export const MODULE_NAV_TAB_STRIP_CLASS_NAME =
  "flex gap-2 overflow-x-auto pb-1";

export function moduleNavActiveTabProps(active: boolean) {
  return active ? ({ "data-module-nav-active": "true" as const }) : {};
}

function scrollActiveModuleNavTabIntoView(container: HTMLElement) {
  const active = container.querySelector<HTMLElement>(
    '[data-module-nav-active="true"]',
  );
  if (!active) {
    return;
  }

  const tabLeft = active.offsetLeft;
  const tabRight = tabLeft + active.offsetWidth;
  const viewLeft = container.scrollLeft;
  const viewRight = viewLeft + container.clientWidth;
  const inset = 4;

  if (tabLeft < viewLeft) {
    container.scrollLeft = Math.max(0, tabLeft - inset);
  } else if (tabRight > viewRight) {
    container.scrollLeft = tabRight - container.clientWidth + inset;
  }
}

type ModuleNavTabStripProps = {
  /** Re-run scroll when route or visible tabs change (typically `pathname`). */
  scrollKey: string;
  children: ReactNode;
  className?: string;
};

export function ModuleNavTabStrip({
  scrollKey,
  children,
  className,
}: ModuleNavTabStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      return;
    }

    scrollActiveModuleNavTabIntoView(strip);

    const frameId = requestAnimationFrame(() => {
      scrollActiveModuleNavTabIntoView(strip);
    });

    return () => cancelAnimationFrame(frameId);
  }, [scrollKey]);

  const mergedClassName = className
    ? `${MODULE_NAV_TAB_STRIP_CLASS_NAME} ${className}`
    : MODULE_NAV_TAB_STRIP_CLASS_NAME;

  return (
    <div ref={stripRef} className={mergedClassName}>
      {children}
    </div>
  );
}
