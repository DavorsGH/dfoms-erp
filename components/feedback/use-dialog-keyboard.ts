"use client";

import { useEffect, type RefObject } from "react";

export function useDialogKeyboard(
  open: boolean,
  options: {
    onPrimary: () => void;
    onDismiss: () => void;
    /** When set, Enter triggers onPrimary only if this button is focused. */
    primaryButtonRef?: RefObject<HTMLButtonElement | null>;
  },
) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        options.onDismiss();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const target = event.target;
        if (target instanceof HTMLTextAreaElement) {
          return;
        }
        if (options.primaryButtonRef) {
          if (document.activeElement !== options.primaryButtonRef.current) {
            return;
          }
        }
        event.preventDefault();
        options.onPrimary();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, options.onDismiss, options.onPrimary, options.primaryButtonRef]);
}
