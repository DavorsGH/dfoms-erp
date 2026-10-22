"use client";

import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  NOTIFICATION_DROPDOWN_PANEL_CLASS,
  notificationDropdownPanelStyle,
} from "@/utils/notification-bell-ui";

type NotificationDropdownPortalProps = {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  /** Extra classes merged onto the panel (e.g. portal text colour). */
  className?: string;
  "aria-label"?: string;
};

/**
 * Renders the notifications panel into `document.body` so sticky table headers
 * and other page stacking contexts cannot cover it.
 */
export default function NotificationDropdownPortal({
  open,
  triggerRef,
  panelRef,
  children,
  className,
  "aria-label": ariaLabel = "Notifications",
}: NotificationDropdownPortalProps) {
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  useEffect(() => {
    if (!open) {
      return;
    }

    function positionPanel() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const isMobile = window.matchMedia("(max-width: 767px)").matches;
      setPanelStyle(notificationDropdownPanelStyle(rect, isMobile));
    }

    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [open, triggerRef]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      style={panelStyle}
      className={
        className
          ? `${NOTIFICATION_DROPDOWN_PANEL_CLASS} ${className}`
          : NOTIFICATION_DROPDOWN_PANEL_CLASS
      }
    >
      {children}
    </div>,
    document.body,
  );
}
