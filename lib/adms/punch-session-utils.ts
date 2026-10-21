export type PunchForSession = {
  id: string;
  punchTimeIso: string;
  staffId: string;
};

export type AttendanceSession = {
  staffId: string;
  sessionDate: string;
  clockInIso: string;
  clockOutIso: string | null;
  punchIds: string[];
  missingClockOut: boolean;
};

/** A device row that already has a clock-in and is still inside the 16-hour window. */
export type OpenSessionAnchor = {
  staffId: string;
  sessionDate: string;
  clockInIso: string;
  punchIds: string[];
};

const DUPLICATE_TAP_MS = 2 * 60 * 1000;
export const SESSION_WINDOW_MS = 16 * 60 * 60 * 1000;

/** True once clock-in is at least 16 hours ago. */
export function sessionWindowHasClosed(clockInIso: string, nowMs: number): boolean {
  const start = Date.parse(clockInIso);
  if (!Number.isFinite(start)) {
    return false;
  }
  return nowMs - start > SESSION_WINDOW_MS;
}

/**
 * attendance_register stores a local clock-in time. Ghana is GMT, so the
 * session start is that date and time as UTC.
 */
export function registerSessionStartIso(
  date: string | null | undefined,
  clockIn: string | null | undefined,
): string | null {
  const day = (date ?? "").slice(0, 10);
  const raw = (clockIn ?? "").trim();
  if (!day || !raw) {
    return null;
  }
  const time = raw.length === 5 ? `${raw}:00` : raw.slice(0, 8);
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  return `${day}T${time}.000Z`;
}

export function registerSessionWindowOpen(
  date: string | null | undefined,
  clockIn: string | null | undefined,
  nowMs: number,
): boolean {
  const startIso = registerSessionStartIso(date, clockIn);
  if (!startIso) {
    return false;
  }
  return !sessionWindowHasClosed(startIso, nowMs);
}

export function filterDuplicateTaps<T extends { punchTimeIso: string }>(
  punches: T[],
): { kept: T[]; duplicateIndices: number[] } {
  const sorted = [...punches].sort(
    (a, b) => Date.parse(a.punchTimeIso) - Date.parse(b.punchTimeIso),
  );
  const kept: T[] = [];
  const duplicateIndices: number[] = [];
  let lastKeptMs = Number.NEGATIVE_INFINITY;

  sorted.forEach((punch, index) => {
    const ms = Date.parse(punch.punchTimeIso);
    if (kept.length > 0 && ms - lastKeptMs < DUPLICATE_TAP_MS) {
      duplicateIndices.push(index);
      return;
    }
    kept.push(punch);
    lastKeptMs = ms;
  });

  return { kept, duplicateIndices };
}

function anchorCoversPunch(anchor: OpenSessionAnchor, punchMs: number): boolean {
  const start = Date.parse(anchor.clockInIso);
  if (!Number.isFinite(start) || punchMs < start) {
    return false;
  }
  return punchMs - start <= SESSION_WINDOW_MS;
}

/**
 * A released or late-processed punch joins an open clock-in when it falls
 * inside that session's 16-hour window. A batch that already contains the
 * clock-in (or an earlier punch) keeps its own pairing.
 */
export function groupPunchesIntoSessions(
  punches: PunchForSession[],
  clockInLocalDate: (iso: string) => string,
  openSessions: OpenSessionAnchor[] = [],
): AttendanceSession[] {
  const byStaff = new Map<string, PunchForSession[]>();
  for (const punch of punches) {
    const list = byStaff.get(punch.staffId) ?? [];
    list.push(punch);
    byStaff.set(punch.staffId, list);
  }

  const sessions: AttendanceSession[] = [];
  const unusedAnchors = [...openSessions];

  for (const [staffId, staffPunches] of byStaff) {
    const sorted = [...staffPunches].sort(
      (a, b) => Date.parse(a.punchTimeIso) - Date.parse(b.punchTimeIso),
    );

    let current: PunchForSession[] = [];
    let sessionStartMs = Number.NaN;
    let anchor: OpenSessionAnchor | null = null;

    function takeAnchor(punchMs: number): OpenSessionAnchor | null {
      let bestIndex = -1;
      let bestStart = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < unusedAnchors.length; index += 1) {
        const candidate = unusedAnchors[index]!;
        if (candidate.staffId !== staffId) {
          continue;
        }
        const start = Date.parse(candidate.clockInIso);
        const batchHasClockIn = sorted.some(
          (punch) => Date.parse(punch.punchTimeIso) <= start,
        );
        if (batchHasClockIn || !anchorCoversPunch(candidate, punchMs)) {
          continue;
        }
        if (start >= bestStart) {
          bestStart = start;
          bestIndex = index;
        }
      }
      if (bestIndex < 0) {
        return null;
      }
      const [chosen] = unusedAnchors.splice(bestIndex, 1);
      return chosen ?? null;
    }

    function flushSession() {
      if (current.length === 0) {
        return;
      }
      const clockInIso = anchor?.clockInIso ?? current[0]!.punchTimeIso;
      const clockOutIso = anchor
        ? current[current.length - 1]!.punchTimeIso
        : current.length > 1
          ? current[current.length - 1]!.punchTimeIso
          : null;
      const punchIds = [
        ...(anchor?.punchIds ?? []),
        ...current.map((punch) => punch.id),
      ];
      sessions.push({
        staffId,
        sessionDate: anchor?.sessionDate ?? clockInLocalDate(clockInIso),
        clockInIso,
        clockOutIso,
        punchIds,
        missingClockOut: clockOutIso == null,
      });
      current = [];
      sessionStartMs = Number.NaN;
      anchor = null;
    }

    for (const punch of sorted) {
      const ms = Date.parse(punch.punchTimeIso);
      if (current.length === 0) {
        anchor = takeAnchor(ms);
        sessionStartMs = anchor ? Date.parse(anchor.clockInIso) : ms;
      }
      if (current.length === 0 || ms - sessionStartMs <= SESSION_WINDOW_MS) {
        current.push(punch);
        continue;
      }
      flushSession();
      anchor = takeAnchor(ms);
      sessionStartMs = anchor ? Date.parse(anchor.clockInIso) : ms;
      current.push(punch);
    }
    flushSession();
  }

  return sessions;
}

/**
 * Earliest punch is clock-in and latest is clock-out, whatever order they
 * arrived. A later check-out cannot become clock-in while an earlier punch
 * is still in the session.
 */
export function recomputeSessionClocks(
  punches: {
    id: string;
    punchTimeIso: string;
    statusCode?: number | null;
  }[],
): {
  clockInIso: string;
  clockOutIso: string | null;
  punchIds: string[];
  missingClockOut: boolean;
} | null {
  const byId = new Map<
    string,
    { id: string; punchTimeIso: string; statusCode?: number | null }
  >();
  for (const punch of punches) {
    if (!punch.id || !Number.isFinite(Date.parse(punch.punchTimeIso))) {
      continue;
    }
    byId.set(punch.id, punch);
  }
  const sorted = [...byId.values()].sort(
    (a, b) =>
      Date.parse(a.punchTimeIso) - Date.parse(b.punchTimeIso) ||
      a.id.localeCompare(b.id),
  );
  if (sorted.length === 0) {
    return null;
  }
  const earliest = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;
  const clockOutIso =
    Date.parse(latest.punchTimeIso) > Date.parse(earliest.punchTimeIso)
      ? latest.punchTimeIso
      : null;
  return {
    clockInIso: earliest.punchTimeIso,
    clockOutIso,
    punchIds: sorted.map((punch) => punch.id),
    missingClockOut: clockOutIso == null,
  };
}

export function hoursWorkedBetween(
  clockInIso: string,
  clockOutIso: string,
): number {
  const diffMs = Date.parse(clockOutIso) - Date.parse(clockInIso);
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return 0;
  }
  return Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
}
