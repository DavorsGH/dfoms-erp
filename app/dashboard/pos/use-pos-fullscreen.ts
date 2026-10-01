"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { usePathname } from "next/navigation";
import { subscribeRegisterDetailDrawerOpen } from "../register-detail-drawer-visibility";

const POS_LAYOUT_FULLSCREEN_CLASS = "pos-layout-fullscreen";

function isPosModalOverlayOpen(blockEscRef: RefObject<boolean>): boolean {
  if (blockEscRef.current) {
    return true;
  }

  return (
    document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 0
  );
}

export function usePosFullscreen(blockEscRef: RefObject<boolean>) {
  const pathname = usePathname();
  const [layoutFullscreen, setLayoutFullscreen] = useState(false);
  const [registerDetailDrawerOpen, setRegisterDetailDrawerOpen] = useState(false);

  const syncLayoutClass = useCallback((active: boolean) => {
    document.documentElement.classList.toggle(
      POS_LAYOUT_FULLSCREEN_CLASS,
      active,
    );
  }, []);

  const exitFullscreen = useCallback(async () => {
    setLayoutFullscreen(false);
    syncLayoutClass(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* layout already cleared */
      }
    }
  }, [syncLayoutClass]);

  const enterFullscreen = useCallback(async () => {
    setLayoutFullscreen(true);
    syncLayoutClass(true);
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      /* layout-only fullscreen when API unavailable */
    }
  }, [syncLayoutClass]);

  const toggleFullscreen = useCallback(() => {
    if (layoutFullscreen) {
      void exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen, layoutFullscreen]);

  useEffect(() => {
    return subscribeRegisterDetailDrawerOpen(setRegisterDetailDrawerOpen);
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      const nativeActive = document.fullscreenElement != null;
      setLayoutFullscreen(nativeActive);
      syncLayoutClass(nativeActive);
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [syncLayoutClass]);

  useEffect(() => {
    if (!layoutFullscreen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      if (registerDetailDrawerOpen || isPosModalOverlayOpen(blockEscRef)) {
        return;
      }
      event.preventDefault();
      void exitFullscreen();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [blockEscRef, exitFullscreen, layoutFullscreen, registerDetailDrawerOpen]);

  useEffect(() => {
    return () => {
      syncLayoutClass(false);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [syncLayoutClass]);

  useEffect(() => {
    if (pathname !== "/dashboard/pos" && layoutFullscreen) {
      void exitFullscreen();
    }
  }, [exitFullscreen, layoutFullscreen, pathname]);

  return {
    layoutFullscreen,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  };
}
