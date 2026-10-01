"use client";

import { useEffect } from "react";

export function useDialogKeyboard(
  open: boolean,
  options: {
    onPrimary: () => void;
    onDismiss: () => void;
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
        event.preventDefault();
        options.onPrimary();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, options.onDismiss, options.onPrimary]);
}
