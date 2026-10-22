const DEFAULT_DEVICE_TIMEZONE = "Africa/Accra";

export function deviceTimezoneOrDefault(timezone: string | null | undefined): string {
  const trimmed = timezone?.trim();
  return trimmed || DEFAULT_DEVICE_TIMEZONE;
}

export function timezoneOffsetHours(timeZone: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    const offsetPart = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const match = offsetPart.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
    if (!match) {
      return 0;
    }
    const hours = Number.parseInt(match[1] ?? "0", 10);
    const minutes = Number.parseInt(match[2] ?? "0", 10);
    return hours + (hours < 0 ? -minutes / 60 : minutes / 60);
  } catch {
    return 0;
  }
}

export function localDateTimeToUtcIso(
  localDateTime: string,
  timeZone: string,
): { punchTimeIso: string; punchLocalDate: string } | null {
  const normalized = localDateTime.trim().replace(/\s+/, "T");
  const match = normalized.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) {
    return null;
  }

  const [, datePart, hour, minute, second] = match;
  const punchLocalDate = datePart!;

  const probe = new Date(`${datePart}T12:00:00Z`);
  const offsetHours = timezoneOffsetHours(timeZone, probe);
  const utcMs =
    Date.UTC(
      Number(datePart!.slice(0, 4)),
      Number(datePart!.slice(5, 7)) - 1,
      Number(datePart!.slice(8, 10)),
      Number(hour),
      Number(minute),
      Number(second),
    ) -
    offsetHours * 60 * 60 * 1000;

  return {
    punchTimeIso: new Date(utcMs).toISOString(),
    punchLocalDate,
  };
}

export function formatTimeInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const second = parts.find((p) => p.type === "second")?.value ?? "00";
  return `${hour}:${minute}:${second}`;
}

export function localDateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
