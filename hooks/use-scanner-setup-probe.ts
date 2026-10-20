"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BARCODE_SCAN_INTER_KEY_MS,
  BARCODE_SCAN_MIN_LENGTH,
  BARCODE_WEDGE_INPUT_ATTR,
} from "@/utils/barcode-scan-utils";

export type ScannerProbeSample = {
  rawValue: string;
  charCount: number;
  receivedEnter: boolean;
  averageInterKeyMs: number | null;
};

export type ScannerProbeVerdict =
  | { status: "ready"; message: string }
  | { status: "fix"; message: string };

function computeVerdict(sample: ScannerProbeSample | null): ScannerProbeVerdict {
  if (!sample || sample.charCount === 0) {
    return {
      status: "fix",
      message: "Scan a test barcode into the box below.",
    };
  }

  if (!sample.receivedEnter) {
    return {
      status: "fix",
      message:
        "No Enter received — scan the “Add Enter/CR suffix” code in your scanner manual.",
    };
  }

  if (sample.charCount < BARCODE_SCAN_MIN_LENGTH) {
    return {
      status: "fix",
      message: `Scan was too short (minimum ${BARCODE_SCAN_MIN_LENGTH} characters).`,
    };
  }

  if (
    sample.averageInterKeyMs != null &&
    sample.averageInterKeyMs > BARCODE_SCAN_INTER_KEY_MS
  ) {
    return {
      status: "fix",
      message:
        "Keystrokes too slow — set USB HID keyboard mode on the scanner (not serial/COM).",
    };
  }

  return {
    status: "ready",
    message: "Scanner ready",
  };
}

export function useScannerSetupProbe(options?: {
  interKeyMs?: number;
  minLength?: number;
}) {
  const interKeyMs = options?.interKeyMs ?? BARCODE_SCAN_INTER_KEY_MS;
  const minLength = options?.minLength ?? BARCODE_SCAN_MIN_LENGTH;

  const [sample, setSample] = useState<ScannerProbeSample | null>(null);
  const bufferRef = useRef("");
  const keyTimesRef = useRef<number[]>([]);
  const lastKeyTimeRef = useRef(0);

  const reset = useCallback(() => {
    bufferRef.current = "";
    keyTimesRef.current = [];
    lastKeyTimeRef.current = 0;
    setSample(null);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (!target.closest(`[${BARCODE_WEDGE_INPUT_ATTR}="probe"]`)) {
        return;
      }

      if (event.key === "Enter") {
        const rawValue = bufferRef.current.trim();
        const times = keyTimesRef.current;
        let averageInterKeyMs: number | null = null;
        if (times.length >= 2) {
          const gaps: number[] = [];
          for (let i = 1; i < times.length; i += 1) {
            gaps.push(times[i]! - times[i - 1]!);
          }
          averageInterKeyMs =
            gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
        }

        setSample({
          rawValue,
          charCount: rawValue.length,
          receivedEnter: true,
          averageInterKeyMs,
        });

        bufferRef.current = "";
        keyTimesRef.current = [];
        lastKeyTimeRef.current = 0;
        event.preventDefault();
        return;
      }

      if (event.key.length !== 1) {
        return;
      }

      const now = Date.now();
      if (
        bufferRef.current.length > 0 &&
        now - lastKeyTimeRef.current > interKeyMs
      ) {
        bufferRef.current = "";
        keyTimesRef.current = [];
      }

      bufferRef.current += event.key;
      keyTimesRef.current.push(now);
      lastKeyTimeRef.current = now;

      setSample({
        rawValue: bufferRef.current,
        charCount: bufferRef.current.length,
        receivedEnter: false,
        averageInterKeyMs: null,
      });
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [interKeyMs]);

  const verdict = computeVerdict(sample);

  return {
    sample,
    verdict,
    reset,
    interKeyMs,
    minLength,
  };
}
