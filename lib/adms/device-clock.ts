import { localDateTimeToUtcIso } from "@/lib/adms/timezone-utils";

/** A fresh device clock this far from the server is flagged. It is never applied. */
export const DEVICE_CLOCK_DRIFT_THRESHOLD_MINUTES = 5;

export function scannerClockDriftNote(minutesOff: number): string {
  const minutes = Math.abs(Math.round(minutesOff));
  return `Scanner clock is ${minutes} minutes off; check the scanner time`;
}

export function isScannerClockDriftNote(note: string | null | undefined): boolean {
  return (note ?? "").trim().startsWith("Scanner clock is ");
}

/** Minutes the fresh device clock is ahead of the server. Negative means behind. */
export function freshDeviceClockDriftMinutes(
  deviceClockIso: string,
  serverNowMs: number,
): number | null {
  const deviceMs = Date.parse(deviceClockIso);
  if (!Number.isFinite(deviceMs) || !Number.isFinite(serverNowMs)) {
    return null;
  }
  return Math.round((deviceMs - serverNowMs) / 60000);
}

export type ReportedPunchTime = {
  punchTimeIso: string;
  punchLocalDate: string;
  reviewNote: string | null;
};

/**
 * Store the punch exactly as the device reported it, in the device time zone.
 * `storedDeviceClockIso` is accepted so callers can pass a previous heartbeat
 * reading, and it is ignored. Only a fresh clock from this request may add a
 * review note, and that note does not move the punch.
 */
export function resolveReportedPunchTime(input: {
  localDateTime: string;
  timeZone: string;
  serverNowMs: number;
  freshDeviceClockIso?: string | null;
  storedDeviceClockIso?: string | null;
}): ReportedPunchTime | null {
  void input.storedDeviceClockIso;
  const converted = localDateTimeToUtcIso(input.localDateTime, input.timeZone);
  if (!converted) {
    return null;
  }
  let reviewNote: string | null = null;
  if (input.freshDeviceClockIso) {
    const minutes = freshDeviceClockDriftMinutes(
      input.freshDeviceClockIso,
      input.serverNowMs,
    );
    if (
      minutes != null &&
      Math.abs(minutes) >= DEVICE_CLOCK_DRIFT_THRESHOLD_MINUTES
    ) {
      reviewNote = scannerClockDriftNote(minutes);
    }
  }
  return {
    punchTimeIso: converted.punchTimeIso,
    punchLocalDate: converted.punchLocalDate,
    reviewNote,
  };
}
