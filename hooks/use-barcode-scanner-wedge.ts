"use client";

import { useEffect, useRef } from "react";
import { BARCODE_SCAN_INTER_KEY_MS } from "@/utils/barcode-scan-utils";

export type UseBarcodeScannerWedgeOptions = {
  enabled?: boolean;
  /** When true, ignore keystrokes (e.g. modal open). */
  paused?: boolean;
  onScan: (rawPayload: string) => void;
  interKeyMs?: number;
};

function shouldIgnoreScanKeystroke(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  if (target.closest('[role="dialog"], dialog')) {
    return true;
  }

  return false;
}

function isPrintableCharacter(key: string): boolean {
  return key.length === 1;
}

/**
 * Buffers fast keyboard-wedge scanner input; fires onScan when Enter is pressed.
 */
export function useBarcodeScannerWedge({
  enabled = true,
  paused = false,
  onScan,
  interKeyMs = BARCODE_SCAN_INTER_KEY_MS,
}: UseBarcodeScannerWedgeOptions) {
  const bufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled || paused) {
      bufferRef.current = "";
      lastKeyTimeRef.current = 0;
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreScanKeystroke(event.target)) {
        bufferRef.current = "";
        lastKeyTimeRef.current = 0;
        return;
      }

      if (event.key === "Enter") {
        const payload = bufferRef.current.trim();
        bufferRef.current = "";
        lastKeyTimeRef.current = 0;
        if (payload) {
          event.preventDefault();
          onScanRef.current(payload);
        }
        return;
      }

      if (!isPrintableCharacter(event.key)) {
        return;
      }

      const now = Date.now();
      if (
        bufferRef.current.length > 0 &&
        now - lastKeyTimeRef.current > interKeyMs
      ) {
        bufferRef.current = "";
      }

      bufferRef.current += event.key;
      lastKeyTimeRef.current = now;
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, paused, interKeyMs]);
}
