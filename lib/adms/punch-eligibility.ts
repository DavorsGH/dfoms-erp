/**
 * Device clocks may sit ahead of the server. A punch inside this skew is
 * stored and held until its own timestamp; it is not rejected and it is not
 * written early.
 */
export const FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1000;

/** Reprocess only punches that have had time to finish the ingest request. */
export const UNPROCESSED_PUNCH_MIN_AGE_MS = 2 * 60 * 1000;

/** Identical processing failures for the same punches are not logged again inside this window. */
export const PROCESSING_ERROR_LOG_WINDOW_MS = 10 * 60 * 1000;

/** True while the punch timestamp is still ahead of `nowMs`. */
export function punchTimeIsStillFuture(
  punchTimeIso: string | null | undefined,
  nowMs: number,
): boolean {
  if (!punchTimeIso) {
    return false;
  }
  const punchMs = Date.parse(punchTimeIso);
  if (!Number.isFinite(punchMs)) {
    return false;
  }
  return punchMs > nowMs;
}

export function unprocessedPunchCutoff(nowMs = Date.now()): string {
  return new Date(nowMs - UNPROCESSED_PUNCH_MIN_AGE_MS).toISOString();
}

/**
 * A stored punch still needs the attendance processor.
 * `process_note` null is eligible. SQL `<> 'future_time'` is not, because
 * NULL comparisons do not match.
 */
export function punchNeedsProcessing(
  punch: {
    staff_id: string | null;
    processed_at: string | null;
    process_note: string | null;
    punch_time?: string | null;
  },
  olderThanIso?: string | null,
  nowMs: number = Date.now(),
  options?: { retryProcessingErrors?: boolean },
): boolean {
  if (!punch.staff_id || punch.processed_at) {
    return false;
  }
  const note = punch.process_note ?? "";
  if (note.endsWith(":dismissed")) {
    return false;
  }
  // A failed punch stays failed until Reprocess or a new ingest for that PIN.
  if (note === "processing_error" && !options?.retryProcessingErrors) {
    return false;
  }
  if (note === "future_time") {
    if (!punch.punch_time) {
      return false;
    }
    return !punchTimeIsStillFuture(punch.punch_time, nowMs);
  }
  if (olderThanIso && punch.punch_time && punch.punch_time >= olderThanIso) {
    return false;
  }
  return true;
}

export function processingErrorLogKey(message: string, punchIds: string[]): string {
  return `${[...punchIds].sort().join("|")}::${message}`;
}

/** True when this exact failure for these punch ids was already logged inside the window. */
export function processingErrorAlreadyLogged(
  previous: { key: string; atMs: number }[],
  message: string,
  punchIds: string[],
  nowMs: number,
  windowMs: number = PROCESSING_ERROR_LOG_WINDOW_MS,
): boolean {
  const key = processingErrorLogKey(message, punchIds);
  return previous.some(
    (entry) => entry.key === key && nowMs - entry.atMs < windowMs,
  );
}
