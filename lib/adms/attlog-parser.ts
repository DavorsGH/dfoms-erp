export type ParsedAttlogLine = {
  devicePin: string;
  localDateTime: string;
  statusCode: number | null;
  verifyCode: number | null;
  workCode: string | null;
  rawLine: string;
};

const ATTLOG_LINE =
  /^(\S+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)(?:\s+(\S+))?(?:\s+(\S+))?/;

function parseOptionalInt(value: string | undefined): number | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseAttlogLine(line: string): ParsedAttlogLine | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\t+/g, " ").replace(/\s+/g, " ");
  const match = normalized.match(ATTLOG_LINE);
  if (!match) {
    return null;
  }

  const [, devicePin, localDateTime, statusRaw, verifyRaw, workRaw] = match;
  if (!devicePin || !localDateTime) {
    return null;
  }

  return {
    devicePin,
    localDateTime,
    statusCode: parseOptionalInt(statusRaw),
    verifyCode: parseOptionalInt(verifyRaw),
    workCode: workRaw?.trim() ? workRaw.trim() : null,
    rawLine: trimmed,
  };
}

export function parseAttlogBody(body: string): ParsedAttlogLine[] {
  const lines = body.split(/\r?\n/);
  const parsed: ParsedAttlogLine[] = [];
  for (const line of lines) {
    const row = parseAttlogLine(line);
    if (row) {
      parsed.push(row);
    }
  }
  return parsed;
}
