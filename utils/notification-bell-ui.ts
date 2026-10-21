import type { CSSProperties } from "react";
import { zClass } from "@/utils/z-index";

/** Shared notification dropdown panel chrome (dashboard + portals). Position via portal. */
export const NOTIFICATION_DROPDOWN_PANEL_CLASS = `${zClass.dropdown} overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg w-[min(24rem,calc(100vw-2rem))]`;

/** Fixed placement for the portaled notifications panel. */
export function notificationDropdownPanelStyle(
  triggerRect: DOMRect,
  isMobile: boolean,
): CSSProperties {
  if (isMobile) {
    return {
      position: "fixed",
      top: "4rem",
      left: "1rem",
      right: "1rem",
      width: "auto",
    };
  }

  return {
    position: "fixed",
    top: triggerRect.bottom + 8,
    right: Math.max(8, window.innerWidth - triggerRect.right),
  };
}
